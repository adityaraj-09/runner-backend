import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { sendMessageSchema, conversationQuerySchema, paginationSchema } from '../validators/schemas.js';

const router = Router();

// Get all conversations
router.get('/conversations', async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: {
      participants: {
        some: { userId: req.userId },
      },
    },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
              isCurrentlyRunning: true,
              lastLocationUpdate: true,
            },
          },
        },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  // Calculate unread count for each conversation
  const conversationsWithUnread = await Promise.all(
    conversations.map(async (conv) => {
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: conv.id,
          senderId: { not: req.userId },
          readAt: null,
        },
      });

      return {
        id: conv.id,
        participants: conv.participants
          .map((p) => ({
            ...p.user,
            isOnline: p.user.lastLocationUpdate
              ? new Date().getTime() - new Date(p.user.lastLocationUpdate).getTime() < 5 * 60 * 1000
              : false,
          }))
          .filter((p) => p.id !== req.userId),
        lastMessage: conv.messages[0] || null,
        unreadCount,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      };
    })
  );

  res.json(conversationsWithUnread);
});

// Get or create conversation with a user
router.post('/conversations', async (req, res) => {
  const { recipientId } = req.body;

  if (!recipientId) {
    throw new AppError('Recipient ID is required', 400);
  }

  if (recipientId === req.userId) {
    throw new AppError('Cannot create conversation with yourself', 400);
  }

  // Check if recipient exists
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
  });

  if (!recipient) {
    throw new AppError('User not found', 404);
  }

  // Check if conversation already exists
  const existingConversation = await prisma.conversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: req.userId } } },
        { participants: { some: { userId: recipientId } } },
      ],
      participants: { every: { userId: { in: [req.userId!, recipientId] } } },
    },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  if (existingConversation) {
    return res.json({
      id: existingConversation.id,
      participants: existingConversation.participants
        .map((p) => p.user)
        .filter((p) => p.id !== req.userId),
      unreadCount: 0,
      createdAt: existingConversation.createdAt,
      updatedAt: existingConversation.updatedAt,
    });
  }

  // Create new conversation
  const conversation = await prisma.conversation.create({
    data: {
      participants: {
        create: [
          { userId: req.userId! },
          { userId: recipientId },
        ],
      },
    },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  res.json({
    id: conversation.id,
    participants: conversation.participants
      .map((p) => p.user)
      .filter((p) => p.id !== req.userId),
    unreadCount: 0,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  });
});

// Get messages for a conversation
router.get('/conversations/:id', validate(conversationQuerySchema, 'query'), async (req, res) => {
  const { id } = req.params;
  const { cursor, limit } = req.query as any;

  // Verify user is participant
  const participation = await prisma.conversationParticipant.findFirst({
    where: { conversationId: id, userId: req.userId },
  });

  if (!participation) {
    throw new AppError('Conversation not found', 404);
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          fullName: true,
          avatarUrl: true,
        },
      },
    },
  });

  const nextCursor = messages.length === limit ? messages[messages.length - 1].id : null;

  res.json({
    messages: messages.reverse(), // Return in chronological order
    nextCursor,
  });
});

// Send a message
router.post('/', validate(sendMessageSchema), async (req, res) => {
  const { recipientId, conversationId, content, imageUrl } = req.body;

  let targetConversationId = conversationId;

  // If recipientId is provided, get or create conversation
  if (recipientId && !conversationId) {
    const existingConv = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: req.userId } } },
          { participants: { some: { userId: recipientId } } },
        ],
      },
    });

    if (existingConv) {
      targetConversationId = existingConv.id;
    } else {
      const newConv = await prisma.conversation.create({
        data: {
          participants: {
            create: [
              { userId: req.userId! },
              { userId: recipientId },
            ],
          },
        },
      });
      targetConversationId = newConv.id;
    }
  }

  if (!targetConversationId) {
    throw new AppError('Conversation ID or recipient ID is required', 400);
  }

  // Verify user is participant
  const participation = await prisma.conversationParticipant.findFirst({
    where: { conversationId: targetConversationId, userId: req.userId },
  });

  if (!participation) {
    throw new AppError('Conversation not found', 404);
  }

  // Create message
  const message = await prisma.message.create({
    data: {
      conversationId: targetConversationId,
      senderId: req.userId!,
      content,
      imageUrl,
    },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          fullName: true,
          avatarUrl: true,
        },
      },
    },
  });

  // Update conversation's updatedAt
  await prisma.conversation.update({
    where: { id: targetConversationId },
    data: { updatedAt: new Date() },
  });

  // Get recipient IDs for notifications
  const participants = await prisma.conversationParticipant.findMany({
    where: { conversationId: targetConversationId, userId: { not: req.userId } },
  });

  // Create notifications for recipients
  for (const participant of participants) {
    await prisma.notification.create({
      data: {
        userId: participant.userId,
        fromUserId: req.userId,
        type: 'MESSAGE',
        title: 'New Message',
        body: content.length > 50 ? content.substring(0, 50) + '...' : content,
        data: { conversationId: targetConversationId },
      },
    });
  }

  res.json(message);
});

// Mark conversation as read
router.post('/conversations/:id/read', async (req, res) => {
  const { id } = req.params;

  // Verify user is participant
  const participation = await prisma.conversationParticipant.findFirst({
    where: { conversationId: id, userId: req.userId },
  });

  if (!participation) {
    throw new AppError('Conversation not found', 404);
  }

  // Mark all unread messages as read
  await prisma.message.updateMany({
    where: {
      conversationId: id,
      senderId: { not: req.userId },
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  res.json({ success: true });
});

// Get unread count
router.get('/unread', async (req, res) => {
  const count = await prisma.message.count({
    where: {
      conversation: {
        participants: { some: { userId: req.userId } },
      },
      senderId: { not: req.userId },
      readAt: null,
    },
  });

  res.json({ count });
});

// Delete a message
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const message = await prisma.message.findFirst({
    where: { id, senderId: req.userId },
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  await prisma.message.delete({ where: { id } });

  res.json({ success: true });
});

// Typing indicator (for real-time updates)
router.post('/conversations/:id/typing', async (req, res) => {
  const { id } = req.params;
  const { isTyping } = req.body;

  // Verify user is participant
  const participation = await prisma.conversationParticipant.findFirst({
    where: { conversationId: id, userId: req.userId },
  });

  if (!participation) {
    throw new AppError('Conversation not found', 404);
  }

  // In a real implementation, this would broadcast via WebSocket
  // For now, just acknowledge
  res.json({ success: true, isTyping });
});

export default router;

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Get notifications
router.get('/', async (req, res) => {
  const { cursor, limit = 20, unreadOnly = false } = req.query;

  const notifications = await prisma.notification.findMany({
    where: {
      userId: req.userId,
      ...(unreadOnly === 'true' && { isRead: false }),
    },
    include: {
      fromUser: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
  });

  const unreadCount = await prisma.notification.count({
    where: {
      userId: req.userId,
      isRead: false,
    },
  });

  res.json({
    notifications,
    unreadCount,
    nextCursor: notifications.length === Number(limit) ? notifications[notifications.length - 1].id : null,
  });
});

// Get unread count
router.get('/unread-count', async (req, res) => {
  const count = await prisma.notification.count({
    where: {
      userId: req.userId,
      isRead: false,
    },
  });

  res.json({ count });
});

// Mark notification as read
router.post('/:id/read', async (req, res) => {
  const notification = await prisma.notification.findFirst({
    where: {
      id: req.params.id,
      userId: req.userId,
    },
  });

  if (!notification) {
    throw new AppError('Notification not found', 404);
  }

  await prisma.notification.update({
    where: { id: req.params.id },
    data: { isRead: true },
  });

  res.json({ success: true });
});

// Mark all notifications as read
router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: {
      userId: req.userId,
      isRead: false,
    },
    data: { isRead: true },
  });

  res.json({ success: true });
});

// Delete notification
router.delete('/:id', async (req, res) => {
  const notification = await prisma.notification.findFirst({
    where: {
      id: req.params.id,
      userId: req.userId,
    },
  });

  if (!notification) {
    throw new AppError('Notification not found', 404);
  }

  await prisma.notification.delete({
    where: { id: req.params.id },
  });

  res.json({ success: true });
});

// Delete all notifications
router.delete('/', async (req, res) => {
  await prisma.notification.deleteMany({
    where: { userId: req.userId },
  });

  res.json({ success: true });
});

export default router;

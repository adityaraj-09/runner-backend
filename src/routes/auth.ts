import { Router } from 'express';
import { clerkClient } from '@clerk/clerk-sdk-node';
import { prisma } from '../config/database.js';

const router = Router();

// Webhook endpoint for Clerk user events
router.post('/webhook', async (req, res) => {
  const { type, data } = req.body;

  try {
    if (type === 'user.created') {
      await prisma.user.create({
        data: {
          clerkId: data.id,
          email: data.email_addresses[0]?.email_address || '',
          username: data.username || `user_${Date.now()}`,
          fullName: `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Runner',
          avatarUrl: data.image_url,
        },
      });
    } else if (type === 'user.updated') {
      await prisma.user.update({
        where: { clerkId: data.id },
        data: {
          email: data.email_addresses[0]?.email_address,
          username: data.username,
          fullName: `${data.first_name || ''} ${data.last_name || ''}`.trim(),
          avatarUrl: data.image_url,
        },
      });
    } else if (type === 'user.deleted') {
      await prisma.user.delete({
        where: { clerkId: data.id },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;

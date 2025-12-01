import { Request, Response, NextFunction } from 'express';
import { clerkClient } from '@clerk/clerk-sdk-node';
import { prisma } from '../config/database.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      clerkUserId?: string;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    // Verify the token with Clerk
    const payload = await clerkClient.verifyToken(token);
    if (!payload?.sub) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Find or create user in our database
    let user = await prisma.user.findUnique({
      where: { clerkId: payload.sub },
    });

    if (!user) {
      const clerkUser = await clerkClient.users.getUser(payload.sub);
      user = await prisma.user.create({
        data: {
          clerkId: payload.sub,
          email: clerkUser.emailAddresses[0]?.emailAddress || '',
          username: clerkUser.username || `user_${Date.now()}`,
          fullName: `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || 'Runner',
          avatarUrl: clerkUser.imageUrl,
        },
      });
    }

    req.userId = user.id;
    req.clerkUserId = payload.sub;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

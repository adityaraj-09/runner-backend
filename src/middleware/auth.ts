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
      console.log('Auth failed: Missing or invalid Authorization header');
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      console.log('Auth failed: Empty token');
      return res.status(401).json({ error: 'Unauthorized: Empty token' });
    }

    // Verify the token with Clerk
    let payload;
    try {
      payload = await clerkClient.verifyToken(token);
    } catch (verifyError: any) {
      console.error('Token verification failed:', verifyError.message || verifyError);
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }

    if (!payload?.sub) {
      console.log('Auth failed: No subject in token payload');
      return res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
    }

    // Find or create user in our database
    let user = await prisma.user.findUnique({
      where: { clerkId: payload.sub },
    });

    if (!user) {
      console.log('Creating new user for clerkId:', payload.sub);
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
      console.log('New user created:', user.id);
    }

    req.userId = user.id;
    req.clerkUserId = payload.sub;
    next();
  } catch (error: any) {
    console.error('Auth middleware error:', error.message || error);
    return res.status(401).json({ error: 'Unauthorized: Authentication failed' });
  }
};

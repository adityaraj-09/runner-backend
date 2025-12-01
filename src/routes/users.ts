import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  updateProfileSchema,
  updateLocationSchema,
  nearbyUsersQuerySchema,
  searchUsersQuerySchema,
  paginationSchema,
  idParamSchema,
} from '../validators/schemas.js';

const router = Router();

// Get current user profile with full stats
router.get('/me', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    include: {
      _count: {
        select: {
          followers: true,
          following: true,
          runs: true,
          posts: true,
          routes: true,
          capturedAreas: true,
        },
      },
      achievements: {
        where: { unlockedAt: { not: null } },
        include: { achievement: true },
        orderBy: { unlockedAt: 'desc' },
        take: 5,
      },
    },
  });

  if (!user) throw new AppError('User not found', 404);

  // Get weekly stats
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const weeklyRuns = await prisma.run.findMany({
    where: {
      userId: req.userId,
      isCompleted: true,
      createdAt: { gte: oneWeekAgo },
    },
  });

  const weeklyDistance = weeklyRuns.reduce((acc, run) => acc + run.distance, 0);
  const weeklyTime = weeklyRuns.reduce((acc, run) => acc + run.duration, 0);

  res.json({
    ...user,
    weeklyStats: {
      distance: weeklyDistance,
      runs: weeklyRuns.length,
      time: weeklyTime,
    },
  });
});

// Update current user profile
router.patch('/me', validate(updateProfileSchema), async (req, res) => {
  const { fullName, username, bio, location, isPublic, avatarUrl, isLocationPublic } = req.body;

  // Check username uniqueness if changing
  if (username) {
    const existingUser = await prisma.user.findFirst({
      where: {
        username,
        NOT: { id: req.userId },
      },
    });
    if (existingUser) {
      throw new AppError('Username already taken', 400);
    }
  }

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      fullName,
      username,
      bio,
      location,
      isPublic,
      avatarUrl,
      isLocationPublic,
    },
  });

  res.json(user);
});

// Update user location
router.post('/me/location', validate(updateLocationSchema), async (req, res) => {
  const { latitude, longitude } = req.body;

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      latitude,
      longitude,
      lastLocationUpdate: new Date(),
    },
  });

  res.json({ success: true, location: { latitude, longitude } });
});

// Get nearby users
router.get('/nearby', validate(nearbyUsersQuerySchema, 'query'), async (req, res) => {
  const { latitude: lat, longitude: lng, radius: radiusKm } = req.query as any;

  // Earth radius in km
  const earthRadius = 6371;

  // Calculate bounding box for efficient filtering
  const latDelta = (radiusKm / earthRadius) * (180 / Math.PI);
  const lngDelta = (radiusKm / earthRadius) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);

  const users = await prisma.user.findMany({
    where: {
      id: { not: req.userId },
      isPublic: true,
      isLocationPublic: true,
      latitude: {
        gte: lat - latDelta,
        lte: lat + latDelta,
      },
      longitude: {
        gte: lng - lngDelta,
        lte: lng + lngDelta,
      },
      lastLocationUpdate: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      avatarUrl: true,
      latitude: true,
      longitude: true,
      isCurrentlyRunning: true,
      totalDistance: true,
      level: true,
      _count: { select: { followers: true } },
    },
  });

  // Calculate actual distance using Haversine formula
  const usersWithDistance = users
    .map((user) => {
      const distance = calculateDistance(lat, lng, user.latitude!, user.longitude!);
      return {
        id: user.id,
        name: user.fullName,
        username: user.username,
        avatarUrl: user.avatarUrl,
        latitude: user.latitude,
        longitude: user.longitude,
        isRunning: user.isCurrentlyRunning,
        distance: Math.round(distance * 100) / 100,
        totalDistance: user.totalDistance,
        level: user.level,
        followers: user._count.followers,
      };
    })
    .filter((user) => user.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance);

  res.json(usersWithDistance);
});

// Get user by ID
router.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      _count: {
        select: {
          followers: true,
          following: true,
          runs: true,
          posts: true,
          routes: true,
        },
      },
      achievements: {
        where: { unlockedAt: { not: null } },
        include: { achievement: true },
        orderBy: { unlockedAt: 'desc' },
      },
    },
  });

  if (!user) throw new AppError('User not found', 404);

  // Check if current user follows this user
  const isFollowing = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: req.userId!,
        followingId: req.params.id,
      },
    },
  });

  // Get recent runs for profile
  const recentRuns = await prisma.run.findMany({
    where: {
      userId: req.params.id,
      isCompleted: true,
      ...(user.isPublic ? {} : { userId: req.userId }), // Only show own runs if private
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      distance: true,
      duration: true,
      avgPace: true,
      createdAt: true,
    },
  });

  res.json({
    ...user,
    isFollowing: !!isFollowing,
    recentRuns,
  });
});

// Get user's runs
router.get('/:id/runs', async (req, res) => {
  const { cursor, limit = 20 } = req.query;

  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
  });

  if (!user) throw new AppError('User not found', 404);

  // Check privacy
  if (!user.isPublic && user.id !== req.userId) {
    const isFollowing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: req.userId!,
          followingId: req.params.id,
        },
      },
    });
    if (!isFollowing) {
      throw new AppError('This user\'s profile is private', 403);
    }
  }

  const runs = await prisma.run.findMany({
    where: {
      userId: req.params.id,
      isCompleted: true,
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
    include: {
      route: { select: { name: true } },
      _count: { select: { coordinates: true, photos: true } },
    },
  });

  res.json(runs);
});

// Get user's posts
router.get('/:id/posts', async (req, res) => {
  const { cursor, limit = 20 } = req.query;

  const posts = await prisma.post.findMany({
    where: {
      userId: req.params.id,
      isPublic: true,
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
    include: {
      user: { select: { id: true, fullName: true, username: true, avatarUrl: true } },
      run: { select: { id: true, distance: true, duration: true, avgPace: true } },
      _count: { select: { likes: true, comments: true } },
    },
  });

  // Check if current user liked each post
  const postsWithLikeStatus = await Promise.all(
    posts.map(async (post) => {
      const liked = await prisma.like.findUnique({
        where: { userId_postId: { userId: req.userId!, postId: post.id } },
      });
      return { ...post, isLiked: !!liked };
    })
  );

  res.json(postsWithLikeStatus);
});

// Follow/unfollow user
router.post('/:id/follow', async (req, res) => {
  const { id } = req.params;

  if (id === req.userId) {
    throw new AppError('Cannot follow yourself', 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!targetUser) {
    throw new AppError('User not found', 404);
  }

  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: req.userId!,
        followingId: id,
      },
    },
  });

  if (existingFollow) {
    await prisma.follow.delete({ where: { id: existingFollow.id } });
    res.json({ following: false });
  } else {
    await prisma.follow.create({
      data: { followerId: req.userId!, followingId: id },
    });

    // Create notification for the followed user
    await prisma.notification.create({
      data: {
        userId: id,
        fromUserId: req.userId,
        type: 'FOLLOW',
        title: 'New follower',
        body: 'started following you',
      },
    });

    res.json({ following: true });
  }
});

// Get user's followers
router.get('/:id/followers', async (req, res) => {
  const { cursor, limit = 20 } = req.query;

  const followers = await prisma.follow.findMany({
    where: { followingId: req.params.id },
    include: {
      follower: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
          totalDistance: true,
          level: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
  });

  // Check if current user follows each follower
  const followersWithStatus = await Promise.all(
    followers.map(async (f) => {
      const isFollowing = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: req.userId!,
            followingId: f.follower.id,
          },
        },
      });
      return {
        ...f.follower,
        isFollowing: !!isFollowing,
        followedAt: f.createdAt,
      };
    })
  );

  res.json(followersWithStatus);
});

// Get user's following
router.get('/:id/following', async (req, res) => {
  const { cursor, limit = 20 } = req.query;

  const following = await prisma.follow.findMany({
    where: { followerId: req.params.id },
    include: {
      following: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
          totalDistance: true,
          level: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
  });

  // Check if current user follows each user
  const followingWithStatus = await Promise.all(
    following.map(async (f) => {
      const isFollowing = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: req.userId!,
            followingId: f.following.id,
          },
        },
      });
      return {
        ...f.following,
        isFollowing: !!isFollowing,
        followedAt: f.createdAt,
      };
    })
  );

  res.json(followingWithStatus);
});

// Search users
router.get('/search', async (req, res) => {
  const { q, limit = 20 } = req.query;

  if (!q || (q as string).length < 2) {
    throw new AppError('Search query must be at least 2 characters', 400);
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: q as string, mode: 'insensitive' } },
        { fullName: { contains: q as string, mode: 'insensitive' } },
      ],
      isPublic: true,
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      avatarUrl: true,
      totalDistance: true,
      level: true,
      _count: { select: { followers: true } },
    },
    take: Number(limit),
    orderBy: { totalDistance: 'desc' },
  });

  res.json(users);
});

// Helper function: Calculate distance using Haversine formula
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default router;

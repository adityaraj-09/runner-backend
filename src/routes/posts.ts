import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  createPostSchema,
  updatePostSchema,
  feedQuerySchema,
  addCommentSchema,
  paginationSchema,
  idParamSchema,
} from '../validators/schemas.js';

const router = Router();

// Get feed posts (from following + own + nearby)
router.get('/feed', validate(feedQuerySchema, 'query'), async (req, res) => {
  const { cursor, limit, type } = req.query as any;

  let whereClause: any = { isPublic: true };

  if (type === 'following') {
    // Get following list
    const following = await prisma.follow.findMany({
      where: { followerId: req.userId },
      select: { followingId: true },
    });
    const followingIds = following.map((f) => f.followingId);
    followingIds.push(req.userId!);
    whereClause.userId = { in: followingIds };
  } else if (type === 'nearby') {
    // Get user's location
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { latitude: true, longitude: true },
    });

    if (user?.latitude && user?.longitude) {
      // Get posts within ~10km (rough approximation)
      const latDelta = 0.09; // ~10km
      const lngDelta = 0.09;

      whereClause.latitude = {
        gte: user.latitude - latDelta,
        lte: user.latitude + latDelta,
      };
      whereClause.longitude = {
        gte: user.longitude - lngDelta,
        lte: user.longitude + lngDelta,
      };
    }
  } else if (type === 'discover') {
    // Show popular/recent public posts
    whereClause.userId = { not: req.userId };
  }

  const posts = await prisma.post.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
          level: true,
        },
      },
      run: {
        select: {
          id: true,
          distance: true,
          duration: true,
          avgPace: true,
          elevationGain: true,
          mapSnapshotUrl: true,
        },
        include: {
          coordinates: {
            orderBy: { timestamp: 'asc' },
            take: 100, // Limit coordinates for feed display
          },
        },
      },
      _count: { select: { likes: true, comments: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
  });

  // Check if current user liked each post
  const postsWithLikeStatus = await Promise.all(
    posts.map(async (post) => {
      const liked = await prisma.like.findUnique({
        where: { userId_postId: { userId: req.userId!, postId: post.id } },
      });
      return {
        ...post,
        isLiked: !!liked,
        likesCount: post._count.likes,
        commentsCount: post._count.comments,
      };
    })
  );

  // Get next cursor
  const nextCursor = posts.length === Number(limit) ? posts[posts.length - 1].id : null;

  res.json({
    posts: postsWithLikeStatus,
    nextCursor,
  });
});

// Create post
router.post('/', validate(createPostSchema), async (req, res) => {
  const { runId, imageUrl, caption, isPublic, latitude, longitude, locationName } = req.body;

  // If runId is provided, verify it belongs to user and is completed
  if (runId) {
    const run = await prisma.run.findFirst({
      where: { id: runId, userId: req.userId, isCompleted: true },
    });
    if (!run) {
      throw new AppError('Run not found or not completed', 404);
    }
  }

  const post = await prisma.post.create({
    data: {
      userId: req.userId!,
      runId,
      imageUrl,
      caption,
      isPublic,
      latitude,
      longitude,
      locationName,
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
        },
      },
      run: {
        select: {
          id: true,
          distance: true,
          duration: true,
          avgPace: true,
          mapSnapshotUrl: true,
        },
        include: {
          coordinates: { orderBy: { timestamp: 'asc' } },
        },
      },
      _count: { select: { likes: true, comments: true } },
    },
  });

  // Create notifications for followers
  const followers = await prisma.follow.findMany({
    where: { followingId: req.userId },
    select: { followerId: true },
  });

  if (followers.length > 0) {
    await prisma.notification.createMany({
      data: followers.map((f) => ({
        userId: f.followerId,
        fromUserId: req.userId,
        type: 'LIKE' as const, // Using LIKE as a placeholder for new post
        title: 'New Post',
        body: 'shared a new run',
        postId: post.id,
      })),
    });
  }

  res.json(post);
});

// Get post by ID with full details
router.get('/:id', async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
          level: true,
          _count: { select: { followers: true } },
        },
      },
      run: {
        select: {
          id: true,
          distance: true,
          duration: true,
          avgPace: true,
          maxPace: true,
          calories: true,
          elevationGain: true,
          mapSnapshotUrl: true,
          startTime: true,
        },
        include: {
          coordinates: { orderBy: { timestamp: 'asc' } },
          splits: { orderBy: { km: 'asc' } },
        },
      },
      comments: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              username: true,
              avatarUrl: true,
            },
          },
          replies: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  username: true,
                  avatarUrl: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        where: { parentId: null }, // Only get top-level comments
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { likes: true, comments: true } },
    },
  });

  if (!post) throw new AppError('Post not found', 404);

  // Check if current user liked the post
  const liked = await prisma.like.findUnique({
    where: { userId_postId: { userId: req.userId!, postId: post.id } },
  });

  // Check if current user follows the post author
  const isFollowing = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: req.userId!,
        followingId: post.userId,
      },
    },
  });

  res.json({
    ...post,
    isLiked: !!liked,
    isFollowingAuthor: !!isFollowing,
    likesCount: post._count.likes,
    commentsCount: post._count.comments,
  });
});

// Like/unlike post
router.post('/:id/like', async (req, res) => {
  const { id } = req.params;

  const post = await prisma.post.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!post) throw new AppError('Post not found', 404);

  const existingLike = await prisma.like.findUnique({
    where: { userId_postId: { userId: req.userId!, postId: id } },
  });

  if (existingLike) {
    await prisma.like.delete({ where: { id: existingLike.id } });
    res.json({ liked: false });
  } else {
    await prisma.like.create({
      data: { userId: req.userId!, postId: id },
    });

    // Create notification for post author (if not liking own post)
    if (post.userId !== req.userId) {
      await prisma.notification.create({
        data: {
          userId: post.userId,
          fromUserId: req.userId,
          type: 'LIKE',
          title: 'New Like',
          body: 'liked your post',
          postId: id,
        },
      });
    }

    res.json({ liked: true });
  }
});

// Get post likes
router.get('/:id/likes', async (req, res) => {
  const { cursor, limit = 20 } = req.query;

  const likes = await prisma.like.findMany({
    where: { postId: req.params.id },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
          level: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
  });

  res.json(likes.map((l) => l.user));
});

// Add comment
router.post('/:id/comments', validate(addCommentSchema), async (req, res) => {
  const { content, parentId } = req.body;

  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    select: { userId: true },
  });

  if (!post) throw new AppError('Post not found', 404);

  // If replying to a comment, verify parent exists
  if (parentId) {
    const parentComment = await prisma.comment.findUnique({
      where: { id: parentId },
    });
    if (!parentComment || parentComment.postId !== req.params.id) {
      throw new AppError('Parent comment not found', 404);
    }
  }

  const comment = await prisma.comment.create({
    data: {
      userId: req.userId!,
      postId: req.params.id,
      content, // Already trimmed by Zod schema
      parentId,
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  });

  // Create notification for post author (if not commenting on own post)
  if (post.userId !== req.userId) {
    await prisma.notification.create({
      data: {
        userId: post.userId,
        fromUserId: req.userId,
        type: 'COMMENT',
        title: 'New Comment',
        body: content.length > 50 ? content.substring(0, 50) + '...' : content,
        postId: req.params.id,
      },
    });
  }

  res.json(comment);
});

// Get comments for post
router.get('/:id/comments', async (req, res) => {
  const { cursor, limit = 20 } = req.query;

  const comments = await prisma.comment.findMany({
    where: {
      postId: req.params.id,
      parentId: null, // Only top-level comments
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
        },
      },
      replies: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { replies: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
  });

  res.json(comments);
});

// Delete comment
router.delete('/:postId/comments/:commentId', async (req, res) => {
  const { postId, commentId } = req.params;

  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
      postId,
      userId: req.userId,
    },
  });

  if (!comment) {
    throw new AppError('Comment not found or unauthorized', 404);
  }

  // Delete all replies first
  await prisma.comment.deleteMany({
    where: { parentId: commentId },
  });

  await prisma.comment.delete({
    where: { id: commentId },
  });

  res.json({ success: true });
});

// Update post
router.patch('/:id', validate(updatePostSchema), async (req, res) => {
  const { caption, isPublic } = req.body;

  const post = await prisma.post.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });

  if (!post) throw new AppError('Post not found', 404);

  const updatedPost = await prisma.post.update({
    where: { id: req.params.id },
    data: {
      caption,
      isPublic,
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
        },
      },
      run: {
        select: {
          id: true,
          distance: true,
          duration: true,
          avgPace: true,
        },
      },
      _count: { select: { likes: true, comments: true } },
    },
  });

  res.json(updatedPost);
});

// Delete post
router.delete('/:id', async (req, res) => {
  const post = await prisma.post.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });

  if (!post) throw new AppError('Post not found', 404);

  await prisma.post.delete({
    where: { id: req.params.id },
  });

  res.json({ success: true });
});

// Share post (get shareable data)
router.get('/:id/share', async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: {
          fullName: true,
          username: true,
        },
      },
      run: {
        select: {
          distance: true,
          duration: true,
          avgPace: true,
          mapSnapshotUrl: true,
        },
      },
    },
  });

  if (!post) throw new AppError('Post not found', 404);
  if (!post.isPublic) throw new AppError('Cannot share private post', 403);

  const shareData = {
    title: `${post.user.fullName}'s Run`,
    text: post.run
      ? `Check out this ${post.run.distance.toFixed(2)}km run!`
      : post.caption || 'Check out this post!',
    imageUrl: post.run?.mapSnapshotUrl || post.imageUrl,
    url: `https://runner.app/posts/${post.id}`, // Placeholder URL
  };

  res.json(shareData);
});

export default router;

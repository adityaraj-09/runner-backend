import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  runsQuerySchema,
  runStatsQuerySchema,
  startRunSchema,
  addCoordinatesSchema,
  completeRunSchema,
  addRunPhotoSchema,
  idParamSchema,
} from '../validators/schemas.js';

const router = Router();

// Get user's runs with filters
router.get('/', validate(runsQuerySchema, 'query'), async (req, res) => {
  const { cursor, limit, completed, startDate, endDate } = req.query as any;

  const whereClause: any = { userId: req.userId };

  if (completed !== undefined) {
    whereClause.isCompleted = completed === 'true';
  }

  if (startDate) {
    whereClause.createdAt = {
      ...whereClause.createdAt,
      gte: new Date(startDate as string),
    };
  }

  if (endDate) {
    whereClause.createdAt = {
      ...whereClause.createdAt,
      lte: new Date(endDate as string),
    };
  }

  const runs = await prisma.run.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
    include: {
      route: { select: { id: true, name: true } },
      _count: { select: { coordinates: true, photos: true, splits: true } },
    },
  });

  res.json(runs);
});

// Get run statistics summary
router.get('/stats', validate(runStatsQuerySchema, 'query'), async (req, res) => {
  const { period } = req.query as any;

  let startDate: Date | undefined;
  const now = new Date();

  switch (period) {
    case 'week':
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'year':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
  }

  const runs = await prisma.run.findMany({
    where: {
      userId: req.userId,
      isCompleted: true,
      ...(startDate && { createdAt: { gte: startDate } }),
    },
    orderBy: { createdAt: 'desc' },
  });

  const totalDistance = runs.reduce((acc, run) => acc + run.distance, 0);
  const totalDuration = runs.reduce((acc, run) => acc + run.duration, 0);
  const totalCalories = runs.reduce((acc, run) => acc + run.calories, 0);
  const totalElevation = runs.reduce((acc, run) => acc + run.elevationGain, 0);

  const avgPace = runs.length > 0
    ? runs.reduce((acc, run) => acc + run.avgPace, 0) / runs.length
    : 0;

  const longestRun = runs.reduce((max, run) =>
    run.distance > max.distance ? run : max,
    { distance: 0 }
  );

  const fastestPace = runs.reduce((min, run) =>
    run.avgPace < min && run.avgPace > 0 ? run.avgPace : min,
    Infinity
  );

  // Group runs by day for chart data
  const runsByDay = runs.reduce((acc: Record<string, number>, run) => {
    const date = run.createdAt.toISOString().split('T')[0];
    acc[date] = (acc[date] || 0) + run.distance;
    return acc;
  }, {});

  res.json({
    totalRuns: runs.length,
    totalDistance,
    totalDuration,
    totalCalories,
    totalElevation,
    avgPace,
    avgDistance: runs.length > 0 ? totalDistance / runs.length : 0,
    longestRun: longestRun.distance,
    fastestPace: fastestPace === Infinity ? 0 : fastestPace,
    runsByDay,
  });
});

// Start a new run
router.post('/start', validate(startRunSchema), async (req, res) => {
  const { routeId, latitude, longitude } = req.body;

  // Create the run
  const run = await prisma.run.create({
    data: {
      userId: req.userId!,
      routeId,
      startTime: new Date(),
    },
  });

  // Update user status
  await prisma.user.update({
    where: { id: req.userId },
    data: {
      isCurrentlyRunning: true,
      currentRunId: run.id,
      ...(latitude && longitude && {
        latitude,
        longitude,
        lastLocationUpdate: new Date(),
      }),
    },
  });

  // If starting with initial coordinates
  if (latitude && longitude) {
    await prisma.runCoordinate.create({
      data: {
        runId: run.id,
        latitude,
        longitude,
        timestamp: new Date(),
      },
    });
  }

  res.json(run);
});

// Pause/resume run
router.post('/:id/pause', async (req, res) => {
  const { id } = req.params;

  const run = await prisma.run.findFirst({
    where: { id, userId: req.userId },
  });

  if (!run) throw new AppError('Run not found', 404);
  if (run.isCompleted) throw new AppError('Run is already completed', 400);

  const updatedRun = await prisma.run.update({
    where: { id },
    data: { isPaused: !run.isPaused },
  });

  res.json(updatedRun);
});

// Add coordinates to run (batch)
router.post('/:id/coordinates', validate(addCoordinatesSchema), async (req, res) => {
  const { id } = req.params;
  const { coordinates } = req.body;

  const run = await prisma.run.findFirst({
    where: { id, userId: req.userId },
  });

  if (!run) throw new AppError('Run not found', 404);
  if (run.isCompleted) throw new AppError('Cannot add coordinates to completed run', 400);

  // Validate and create coordinates
  const coordsData = coordinates.map((coord: any) => ({
    runId: id,
    latitude: coord.latitude,
    longitude: coord.longitude,
    altitude: coord.altitude || null,
    speed: coord.speed || null,
    accuracy: coord.accuracy || null,
    heading: coord.heading || null,
    timestamp: new Date(coord.timestamp),
    heartRate: coord.heartRate || null,
  }));

  await prisma.runCoordinate.createMany({
    data: coordsData,
  });

  // Update user's last known location
  const lastCoord = coordinates[coordinates.length - 1];
  await prisma.user.update({
    where: { id: req.userId },
    data: {
      latitude: lastCoord.latitude,
      longitude: lastCoord.longitude,
      lastLocationUpdate: new Date(),
    },
  });

  res.json({ success: true, count: coordinates.length });
});

// Complete run with full stats
router.post('/:id/complete', validate(completeRunSchema), async (req, res) => {
  const { id } = req.params;
  const {
    distance,
    duration,
    avgPace,
    maxPace,
    minPace,
    calories,
    elevation,
    elevationGain,
    elevationLoss,
    splits,
    weather,
    mapSnapshotUrl,
  } = req.body;

  const run = await prisma.run.findFirst({
    where: { id, userId: req.userId },
    include: { coordinates: true },
  });

  if (!run) throw new AppError('Run not found', 404);
  if (run.isCompleted) throw new AppError('Run is already completed', 400);

  // Update the run
  const updatedRun = await prisma.run.update({
    where: { id },
    data: {
      endTime: new Date(),
      distance: distance || 0,
      duration: duration || 0,
      avgPace: avgPace || 0,
      maxPace: maxPace || 0,
      minPace: minPace || 0,
      calories: calories || 0,
      elevation: elevation || 0,
      elevationGain: elevationGain || 0,
      elevationLoss: elevationLoss || 0,
      isCompleted: true,
      isPaused: false,
      weather,
      mapSnapshotUrl,
    },
    include: {
      coordinates: { orderBy: { timestamp: 'asc' } },
      splits: { orderBy: { km: 'asc' } },
    },
  });

  // Create splits if provided
  if (splits?.length) {
    await prisma.runSplit.createMany({
      data: splits.map((split: any) => ({
        runId: id,
        km: split.km,
        time: split.time,
        pace: split.pace,
        elevation: split.elevation || 0,
        avgHeartRate: split.avgHeartRate || null,
      })),
    });
  }

  // Update user stats
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      totalDistance: { increment: distance || 0 },
      totalRuns: { increment: 1 },
      totalTime: { increment: duration || 0 },
      xp: { increment: Math.floor((distance || 0) * 10) },
      isCurrentlyRunning: false,
      currentRunId: null,
    },
  });

  // Calculate and update level
  const newLevel = Math.floor(user.xp / 1000) + 1;
  if (newLevel > user.level) {
    await prisma.user.update({
      where: { id: req.userId },
      data: { level: newLevel },
    });

    // Create level up notification
    await prisma.notification.create({
      data: {
        userId: req.userId!,
        type: 'ACHIEVEMENT',
        title: 'Level Up!',
        body: `Congratulations! You reached level ${newLevel}`,
        runId: id,
      },
    });
  }

  // Check achievements
  await checkAchievements(req.userId!, distance || 0, updatedRun);

  // Create completion notification
  await prisma.notification.create({
    data: {
      userId: req.userId!,
      type: 'RUN_COMPLETED',
      title: 'Run Completed',
      body: `Great job! You ran ${(distance || 0).toFixed(2)} km`,
      runId: id,
    },
  });

  res.json(updatedRun);
});

// Get run by ID with full details
router.get('/:id', async (req, res) => {
  const run = await prisma.run.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
        },
      },
      route: {
        select: {
          id: true,
          name: true,
          difficulty: true,
        },
      },
      coordinates: { orderBy: { timestamp: 'asc' } },
      splits: { orderBy: { km: 'asc' } },
      photos: { orderBy: { takenAt: 'asc' } },
      posts: {
        include: {
          _count: { select: { likes: true, comments: true } },
        },
      },
    },
  });

  if (!run) throw new AppError('Run not found', 404);

  // Check access
  if (run.userId !== req.userId) {
    const user = await prisma.user.findUnique({
      where: { id: run.userId },
    });
    if (!user?.isPublic) {
      const isFollowing = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: req.userId!,
            followingId: run.userId,
          },
        },
      });
      if (!isFollowing) {
        throw new AppError('Access denied', 403);
      }
    }
  }

  res.json(run);
});

// Add photo to run
router.post('/:id/photos', validate(addRunPhotoSchema), async (req, res) => {
  const { id } = req.params;
  const { imageUrl, latitude, longitude, caption } = req.body;

  const run = await prisma.run.findFirst({
    where: { id, userId: req.userId },
  });

  if (!run) throw new AppError('Run not found', 404);

  const photo = await prisma.runPhoto.create({
    data: {
      runId: id,
      imageUrl,
      latitude,
      longitude,
      caption,
    },
  });

  res.json(photo);
});

// Delete run
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const run = await prisma.run.findFirst({
    where: { id, userId: req.userId },
  });

  if (!run) throw new AppError('Run not found', 404);

  // If run was completed, decrement user stats
  if (run.isCompleted) {
    await prisma.user.update({
      where: { id: req.userId },
      data: {
        totalDistance: { decrement: run.distance },
        totalRuns: { decrement: 1 },
        totalTime: { decrement: run.duration },
        xp: { decrement: Math.floor(run.distance * 10) },
      },
    });
  }

  await prisma.run.delete({ where: { id } });

  res.json({ success: true });
});

// Helper: Check and award achievements
async function checkAchievements(userId: string, runDistance: number, run: any) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      achievements: true,
    },
  });

  if (!user) return;

  const achievements = await prisma.achievement.findMany();

  for (const achievement of achievements) {
    // Skip if already unlocked
    const existing = user.achievements.find(a => a.achievementId === achievement.id);
    if (existing?.unlockedAt) continue;

    let progress = 0;
    let shouldUnlock = false;

    switch (achievement.type) {
      case 'TOTAL_DISTANCE':
        progress = user.totalDistance;
        shouldUnlock = user.totalDistance >= achievement.threshold;
        break;
      case 'TOTAL_RUNS':
        progress = user.totalRuns;
        shouldUnlock = user.totalRuns >= achievement.threshold;
        break;
      case 'SINGLE_RUN_DISTANCE':
        progress = runDistance;
        shouldUnlock = runDistance >= achievement.threshold;
        break;
      case 'SINGLE_RUN_PACE':
        progress = run.avgPace;
        shouldUnlock = run.avgPace > 0 && run.avgPace <= achievement.threshold;
        break;
    }

    // Update or create achievement progress
    await prisma.userAchievement.upsert({
      where: {
        userId_achievementId: { userId, achievementId: achievement.id },
      },
      create: {
        userId,
        achievementId: achievement.id,
        progress,
        unlockedAt: shouldUnlock ? new Date() : null,
      },
      update: {
        progress,
        unlockedAt: shouldUnlock ? new Date() : undefined,
      },
    });

    // Award XP and notify if unlocked
    if (shouldUnlock && !existing?.unlockedAt) {
      await prisma.user.update({
        where: { id: userId },
        data: { xp: { increment: achievement.xpReward } },
      });

      await prisma.notification.create({
        data: {
          userId,
          type: 'ACHIEVEMENT',
          title: 'Achievement Unlocked!',
          body: `You earned "${achievement.name}"`,
          data: { achievementId: achievement.id },
        },
      });
    }
  }
}

export default router;

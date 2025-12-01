import { Router } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

// Get leaderboard
router.get('/', async (req, res) => {
  const { period = 'week', metric = 'distance', limit = 50 } = req.query;

  let startDate: Date;
  const now = new Date();

  switch (period) {
    case 'week':
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    default:
      startDate = new Date(0);
  }

  if (metric === 'distance') {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        fullName: true,
        username: true,
        avatarUrl: true,
        totalDistance: true,
        runs: {
          where: { isCompleted: true, createdAt: { gte: startDate } },
          select: { distance: true },
        },
      },
      orderBy: { totalDistance: 'desc' },
      take: Number(limit),
    });

    const leaderboard = users.map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      name: user.fullName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      value: period === 'all'
        ? user.totalDistance
        : user.runs.reduce((sum, run) => sum + run.distance, 0),
    }));

    res.json(leaderboard);
  } else if (metric === 'runs') {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        fullName: true,
        username: true,
        avatarUrl: true,
        _count: {
          select: {
            runs: { where: { isCompleted: true, ...(period !== 'all' && { createdAt: { gte: startDate } }) } },
          },
        },
      },
      orderBy: { runs: { _count: 'desc' } },
      take: Number(limit),
    });

    const leaderboard = users.map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      name: user.fullName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      value: user._count.runs,
    }));

    res.json(leaderboard);
  } else {
    // Streak leaderboard - simplified implementation
    const users = await prisma.user.findMany({
      select: {
        id: true,
        fullName: true,
        username: true,
        avatarUrl: true,
        level: true,
      },
      orderBy: { level: 'desc' },
      take: Number(limit),
    });

    const leaderboard = users.map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      name: user.fullName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      value: user.level,
    }));

    res.json(leaderboard);
  }
});

// Get user's rank
router.get('/my-rank', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { totalDistance: true },
  });

  const rank = await prisma.user.count({
    where: { totalDistance: { gt: user?.totalDistance || 0 } },
  });

  res.json({ rank: rank + 1, totalDistance: user?.totalDistance || 0 });
});

export default router;

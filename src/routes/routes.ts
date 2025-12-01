import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { Difficulty } from '@prisma/client';

const router = Router();

// Get all public routes
router.get('/', async (req, res) => {
  const { difficulty, search } = req.query;
  const routes = await prisma.route.findMany({
    where: {
      isPublic: true,
      ...(difficulty && { difficulty: difficulty as Difficulty }),
      ...(search && { name: { contains: search as string, mode: 'insensitive' } }),
    },
    include: { user: { select: { id: true, fullName: true, username: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(routes);
});

// Get user's routes
router.get('/my', async (req, res) => {
  const routes = await prisma.route.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(routes);
});

// Create route
router.post('/', async (req, res) => {
  const { name, description, distance, estimatedTime, difficulty, elevation, isPublic, coordinates } = req.body;

  const route = await prisma.route.create({
    data: {
      userId: req.userId!,
      name,
      description,
      distance,
      estimatedTime,
      difficulty: difficulty?.toUpperCase() || 'EASY',
      elevation,
      isPublic,
      coordinates: {
        create: coordinates.map((coord: any, index: number) => ({
          latitude: coord.latitude,
          longitude: coord.longitude,
          altitude: coord.altitude,
          order: index,
        })),
      },
    },
    include: { coordinates: { orderBy: { order: 'asc' } } },
  });

  res.json(route);
});

// Get route by ID
router.get('/:id', async (req, res) => {
  const route = await prisma.route.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, fullName: true, username: true, avatarUrl: true } },
      coordinates: { orderBy: { order: 'asc' } },
    },
  });
  if (!route) throw new AppError('Route not found', 404);
  res.json(route);
});

// Like/unlike route
router.post('/:id/like', async (req, res) => {
  const { id } = req.params;
  // Simplified - would need a proper likes table for routes
  await prisma.route.update({
    where: { id },
    data: { likes: { increment: 1 } },
  });
  res.json({ success: true });
});

export default router;

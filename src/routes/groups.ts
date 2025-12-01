import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Get user's groups
router.get('/my', async (req, res) => {
  const memberships = await prisma.groupMember.findMany({
    where: { userId: req.userId },
    include: {
      group: {
        include: {
          _count: { select: { members: true, events: true } },
          events: { where: { startTime: { gte: new Date() } }, take: 1, orderBy: { startTime: 'asc' } },
        },
      },
    },
  });
  res.json(memberships.map((m) => ({ ...m.group, role: m.role })));
});

// Discover groups
router.get('/discover', async (req, res) => {
  const groups = await prisma.group.findMany({
    where: { isPublic: true },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(groups);
});

// Create group
router.post('/', async (req, res) => {
  const { name, description, imageUrl, isPublic } = req.body;

  const group = await prisma.group.create({
    data: {
      name,
      description,
      imageUrl,
      ownerId: req.userId!,
      isPublic,
      members: { create: { userId: req.userId!, role: 'OWNER' } },
    },
    include: { _count: { select: { members: true } } },
  });

  res.json(group);
});

// Get group by ID
router.get('/:id', async (req, res) => {
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      members: {
        include: { user: { select: { id: true, fullName: true, username: true, avatarUrl: true } } },
        orderBy: { joinedAt: 'asc' },
      },
      events: {
        where: { startTime: { gte: new Date() } },
        include: { _count: { select: { participants: true } } },
        orderBy: { startTime: 'asc' },
      },
      _count: { select: { members: true, events: true } },
    },
  });
  if (!group) throw new AppError('Group not found', 404);
  res.json(group);
});

// Join/leave group
router.post('/:id/join', async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.userId!, groupId: id } },
  });

  if (existing) {
    if (existing.role === 'OWNER') throw new AppError('Owner cannot leave group', 400);
    await prisma.groupMember.delete({ where: { id: existing.id } });
    res.json({ joined: false });
  } else {
    await prisma.groupMember.create({ data: { userId: req.userId!, groupId: id } });
    res.json({ joined: true });
  }
});

// Create event
router.post('/:id/events', async (req, res) => {
  const { name, description, startTime, meetingAddress, meetingLat, meetingLng, routeId, maxParticipants } = req.body;

  const event = await prisma.groupEvent.create({
    data: {
      groupId: req.params.id,
      creatorId: req.userId!,
      routeId,
      name,
      description,
      startTime: new Date(startTime),
      meetingAddress,
      meetingLat,
      meetingLng,
      maxParticipants,
      participants: { create: { userId: req.userId!, status: 'GOING' } },
    },
    include: { _count: { select: { participants: true } } },
  });

  res.json(event);
});

// Get event by ID
router.get('/events/:eventId', async (req, res) => {
  const event = await prisma.groupEvent.findUnique({
    where: { id: req.params.eventId },
    include: {
      group: true,
      route: { include: { coordinates: { orderBy: { order: 'asc' } } } },
      participants: {
        include: { user: { select: { id: true, fullName: true, username: true, avatarUrl: true } } },
      },
      _count: { select: { participants: true } },
    },
  });
  if (!event) throw new AppError('Event not found', 404);
  res.json(event);
});

// RSVP to event
router.post('/events/:eventId/rsvp', async (req, res) => {
  const { eventId } = req.params;
  const { status } = req.body;

  const existing = await prisma.eventParticipant.findUnique({
    where: { userId_eventId: { userId: req.userId!, eventId } },
  });

  if (existing) {
    await prisma.eventParticipant.update({
      where: { id: existing.id },
      data: { status },
    });
  } else {
    await prisma.eventParticipant.create({
      data: { userId: req.userId!, eventId, status },
    });
  }

  res.json({ status });
});

export default router;

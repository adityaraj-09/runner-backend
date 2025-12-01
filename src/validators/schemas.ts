import { z } from 'zod';

// Common schemas
export const paginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// User schemas
export const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(100).optional(),
  isPublic: z.boolean().optional(),
  avatarUrl: z.string().url().optional().nullable(),
  isLocationPublic: z.boolean().optional(),
});

export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const nearbyUsersQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(0.1).max(50).default(5),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Run schemas
export const startRunSchema = z.object({
  routeId: z.string().uuid().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const runCoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional().nullable(),
  speed: z.number().min(0).optional().nullable(),
  accuracy: z.number().min(0).optional().nullable(),
  heading: z.number().min(0).max(360).optional().nullable(),
  timestamp: z.string().datetime().or(z.date()),
  heartRate: z.number().int().min(0).max(300).optional().nullable(),
});

export const addCoordinatesSchema = z.object({
  coordinates: z.array(runCoordinateSchema).min(1).max(1000),
});

export const runSplitSchema = z.object({
  km: z.number().int().min(1),
  time: z.number().min(0),
  pace: z.number().min(0),
  elevation: z.number().optional().default(0),
  avgHeartRate: z.number().int().min(0).max(300).optional().nullable(),
});

export const completeRunSchema = z.object({
  distance: z.number().min(0).default(0),
  duration: z.number().int().min(0).default(0),
  avgPace: z.number().min(0).default(0),
  maxPace: z.number().min(0).optional().default(0),
  minPace: z.number().min(0).optional().default(0),
  calories: z.number().int().min(0).default(0),
  elevation: z.number().optional().default(0),
  elevationGain: z.number().min(0).optional().default(0),
  elevationLoss: z.number().min(0).optional().default(0),
  splits: z.array(runSplitSchema).optional(),
  weather: z.string().max(100).optional().nullable(),
  mapSnapshotUrl: z.string().url().optional().nullable(),
});

export const runsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  completed: z.enum(['true', 'false']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const runStatsQuerySchema = z.object({
  period: z.enum(['week', 'month', 'year', 'all']).default('all'),
});

export const addRunPhotoSchema = z.object({
  imageUrl: z.string().url(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  caption: z.string().max(500).optional(),
});

// Post schemas
export const createPostSchema = z.object({
  runId: z.string().uuid().optional(),
  imageUrl: z.string().url().optional().nullable(),
  caption: z.string().max(2000).optional(),
  isPublic: z.boolean().default(true),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locationName: z.string().max(200).optional(),
});

export const updatePostSchema = z.object({
  caption: z.string().max(2000).optional(),
  isPublic: z.boolean().optional(),
});

export const feedQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z.enum(['following', 'nearby', 'discover']).default('following'),
});

export const addCommentSchema = z.object({
  content: z.string().min(1).max(1000).transform((val) => val.trim()),
  parentId: z.string().uuid().optional(),
});

// Auth schemas
export const syncUserSchema = z.object({
  clerkId: z.string().min(1),
  email: z.string().email(),
  fullName: z.string().min(1).max(100),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

// Notification schemas
export const registerPushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

export const notificationsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z.enum(['true', 'false']).optional(),
});

// Group/Route schemas
export const createRouteSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  distance: z.number().min(0),
  difficulty: z.enum(['EASY', 'MODERATE', 'HARD', 'EXTREME']).default('MODERATE'),
  isPublic: z.boolean().default(true),
  coordinates: z.array(coordinateSchema).min(2),
  elevation: z.number().optional(),
  estimatedTime: z.number().int().min(0).optional(),
});

export const createGroupSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional().nullable(),
  isPrivate: z.boolean().default(false),
  location: z.string().max(200).optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional().nullable(),
  isPrivate: z.boolean().optional(),
  location: z.string().max(200).optional(),
});

// Leaderboard schemas
export const leaderboardQuerySchema = z.object({
  period: z.enum(['week', 'month', 'year', 'all']).default('week'),
  metric: z.enum(['distance', 'runs', 'time', 'pace']).default('distance'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Message schemas (for future DM feature)
export const sendMessageSchema = z.object({
  recipientId: z.string().uuid(),
  content: z.string().min(1).max(2000).transform((val) => val.trim()),
  imageUrl: z.string().url().optional(),
});

export const conversationQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

// ID param schema
export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const postCommentParamsSchema = z.object({
  postId: z.string().uuid(),
  commentId: z.string().uuid(),
});

// Type exports
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;
export type AddCoordinatesInput = z.infer<typeof addCoordinatesSchema>;
export type CompleteRunInput = z.infer<typeof completeRunSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type SyncUserInput = z.infer<typeof syncUserSchema>;
export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

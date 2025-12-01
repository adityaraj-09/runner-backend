import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';
import { initializeDatabase, disconnectDatabase } from './config/database.js';

// Routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import runRoutes from './routes/runs.js';
import routeRoutes from './routes/routes.js';
import postRoutes from './routes/posts.js';
import groupRoutes from './routes/groups.js';
import leaderboardRoutes from './routes/leaderboard.js';
import notificationRoutes from './routes/notifications.js';
import messageRoutes from './routes/messages.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: '*',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/runs', authMiddleware, runRoutes);
app.use('/api/routes', authMiddleware, routeRoutes);
app.use('/api/posts', authMiddleware, postRoutes);
app.use('/api/groups', authMiddleware, groupRoutes);
app.use('/api/leaderboard', authMiddleware, leaderboardRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/messages', authMiddleware, messageRoutes);

// Error handler
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Start server with database initialization
async function startServer() {
  try {
    // Initialize database (migrations + seeding)
    await initializeDatabase();

    // Start the server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        await disconnectDatabase();
        console.log('👋 Server closed');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;

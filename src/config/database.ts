import { PrismaClient, AchievementType } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

/**
 * Initialize the database - run migrations and seed if needed
 */
export async function initializeDatabase(): Promise<void> {
  console.log('🔄 Initializing database...');

  try {
    // Test database connection first
    await prisma.$connect();
    console.log('✅ Database connection established');

    // Try to run migrations
    console.log('🔄 Running database migrations...');
    try {
      await execAsync('npx prisma migrate deploy');
      console.log('✅ Migrations applied successfully');
    } catch (migrateError: any) {
      // If no migrations exist or migration fails, try db push in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('🔄 Migrations failed, attempting schema push...');
        await execAsync('npx prisma db push');
        console.log('✅ Schema pushed successfully');

        // Regenerate client after schema push
        console.log('🔄 Regenerating Prisma client...');
        await execAsync('npx prisma generate');
        console.log('✅ Prisma client regenerated');
        console.log('⚠️  Please restart the server for changes to take effect');
      } else {
        throw migrateError;
      }
    }

    // Seed default data if needed
    await seedDefaultData();

    console.log('✅ Database initialization complete');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

/**
 * Seed default data (achievements, etc.)
 */
async function seedDefaultData(): Promise<void> {
  console.log('🔄 Checking for seed data...');

  try {
    // Check if achievements exist
    const achievementCount = await prisma.achievement.count();

    if (achievementCount === 0) {
      console.log('🌱 Seeding default achievements...');

      const defaultAchievements: Array<{
        name: string;
        description: string;
        icon: string;
        type: AchievementType;
        threshold: number;
        xpReward: number;
      }> = [
        // Distance achievements
        { name: 'First Steps', description: 'Complete your first run', icon: '👟', type: AchievementType.TOTAL_RUNS, threshold: 1, xpReward: 50 },
        { name: 'Getting Started', description: 'Run a total of 5 km', icon: '🏃', type: AchievementType.TOTAL_DISTANCE, threshold: 5, xpReward: 100 },
        { name: '10K Club', description: 'Run a total of 10 km', icon: '🎯', type: AchievementType.TOTAL_DISTANCE, threshold: 10, xpReward: 200 },
        { name: 'Half Marathon', description: 'Run a total of 21.1 km', icon: '🏅', type: AchievementType.TOTAL_DISTANCE, threshold: 21.1, xpReward: 500 },
        { name: 'Marathon', description: 'Run a total of 42.2 km', icon: '🏆', type: AchievementType.TOTAL_DISTANCE, threshold: 42.2, xpReward: 1000 },
        { name: 'Century', description: 'Run a total of 100 km', icon: '💯', type: AchievementType.TOTAL_DISTANCE, threshold: 100, xpReward: 2000 },
        { name: 'Ultra Runner', description: 'Run a total of 500 km', icon: '⚡', type: AchievementType.TOTAL_DISTANCE, threshold: 500, xpReward: 5000 },

        // Single run achievements
        { name: '5K Runner', description: 'Complete a 5 km run', icon: '5️⃣', type: AchievementType.SINGLE_RUN_DISTANCE, threshold: 5, xpReward: 150 },
        { name: '10K Runner', description: 'Complete a 10 km run', icon: '🔟', type: AchievementType.SINGLE_RUN_DISTANCE, threshold: 10, xpReward: 300 },
        { name: 'Half Marathoner', description: 'Complete a 21.1 km run', icon: '🥈', type: AchievementType.SINGLE_RUN_DISTANCE, threshold: 21.1, xpReward: 750 },
        { name: 'Marathoner', description: 'Complete a 42.2 km run', icon: '🥇', type: AchievementType.SINGLE_RUN_DISTANCE, threshold: 42.2, xpReward: 1500 },

        // Run count achievements
        { name: 'Regular Runner', description: 'Complete 10 runs', icon: '🔁', type: AchievementType.TOTAL_RUNS, threshold: 10, xpReward: 200 },
        { name: 'Dedicated', description: 'Complete 50 runs', icon: '💪', type: AchievementType.TOTAL_RUNS, threshold: 50, xpReward: 500 },
        { name: 'Committed', description: 'Complete 100 runs', icon: '🎖️', type: AchievementType.TOTAL_RUNS, threshold: 100, xpReward: 1000 },
        { name: 'Legend', description: 'Complete 500 runs', icon: '👑', type: AchievementType.TOTAL_RUNS, threshold: 500, xpReward: 5000 },

        // Pace achievements (pace in min/km - lower is better)
        { name: 'Speed Demon', description: 'Run at sub 5:00 min/km pace', icon: '💨', type: AchievementType.SINGLE_RUN_PACE, threshold: 5, xpReward: 300 },
        { name: 'Lightning Fast', description: 'Run at sub 4:30 min/km pace', icon: '⚡', type: AchievementType.SINGLE_RUN_PACE, threshold: 4.5, xpReward: 500 },
        { name: 'Elite Pace', description: 'Run at sub 4:00 min/km pace', icon: '🚀', type: AchievementType.SINGLE_RUN_PACE, threshold: 4, xpReward: 1000 },
      ];

      await prisma.achievement.createMany({
        data: defaultAchievements,
        skipDuplicates: true,
      });

      console.log(`✅ Seeded ${defaultAchievements.length} achievements`);
    } else {
      console.log(`ℹ️ ${achievementCount} achievements already exist, skipping seed`);
    }
  } catch (error: any) {
    // If table doesn't exist yet, skip seeding (will be created on next restart)
    if (error.code === 'P2021') {
      console.log('⚠️ Achievement table not ready, skipping seed (restart server after schema sync)');
    } else {
      throw error;
    }
  }
}

/**
 * Gracefully disconnect from the database
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log('🔌 Database disconnected');
}

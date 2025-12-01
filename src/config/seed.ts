import { PrismaClient, AchievementType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Seed achievements
  const achievements = [
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

  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { name: achievement.name },
      update: achievement,
      create: achievement,
    });
  }

  console.log(`✅ Seeded ${achievements.length} achievements`);
  console.log('✅ Database seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

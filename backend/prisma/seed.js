const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding STAR database...\n');

  // Create the ERP project
  const erp = await prisma.project.upsert({
    where: { slug: 'erp-platform' },
    update: {},
    create: {
      name: 'ERP Platform',
      slug: 'erp-platform',
      description: 'B2B internal ERP with HR, Projects, TimeCard, Leave, Finance, and Reports modules',
      repository: `${process.env.GITHUB_OWNER || 'your_github_username'}/${process.env.GITHUB_REPO || 'erp-platform'}`,
    },
  });

  console.log(`  Project created: ${erp.name} (${erp.slug})`);

  // Create a pipeline for the ERP
  const pipeline = await prisma.pipeline.upsert({
    where: { id: 'default-erp-pipeline' },
    update: {},
    create: {
      id: 'default-erp-pipeline',
      projectId: erp.id,
      name: 'Production Pipeline',
      branch: 'main',
      isActive: true,
    },
  });

  console.log(`  Pipeline created: ${pipeline.name} (branch: ${pipeline.branch})`);

  // Set initial system config
  const configs = [
    { key: 'active_environment', value: 'BLUE' },
    { key: 'approval_required', value: 'true' },
    { key: 'auto_snapshot', value: 'true' },
    { key: 'notify_on_deploy', value: 'true' },
    { key: 'health_check_enabled', value: 'true' },
    { key: 'health_check_timeout', value: '30' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config,
    });
  }

  console.log(`  System config: ${configs.length} keys set`);
  console.log('\nSeed complete.');
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

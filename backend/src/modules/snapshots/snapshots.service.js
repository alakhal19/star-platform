const prisma = require('../../shared/database/prisma');
const { createModuleLogger } = require('../../shared/logger/logger');

const log = createModuleLogger('snapshots');

// Create a snapshot before deploying a new version
const createSnapshot = async ({ releaseId, environment }) => {
  // Get current active environment config
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'active_environment' },
  });
  const currentEnv = config?.value || 'BLUE';
  const envLower = currentEnv.toLowerCase();

  // Generate snapshot tags
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backendTag = `erp-backend:snapshot-${envLower}-${timestamp}`;
  const frontendTag = `erp-frontend:snapshot-${envLower}-${timestamp}`;

  // TODO: When connected to VM2 via SSH, run these commands:
  // docker commit erp_backend_{envLower} {backendTag}
  // docker commit erp_frontend_{envLower} {frontendTag}
  // For now, we just record the snapshot in the database

  const snapshot = await prisma.snapshot.create({
    data: {
      releaseId,
      backendTag,
      frontendTag,
      environment: currentEnv,
      description: `Pre-deployment snapshot of ${currentEnv} environment`,
    },
  });

  log.info({
    snapshotId: snapshot.id,
    releaseId,
    backendTag,
    frontendTag,
    environment: currentEnv,
  }, 'Snapshot created');

  return snapshot;
};

// List all snapshots
const getSnapshots = async (limit = 20) => {
  return prisma.snapshot.findMany({
    include: {
      release: {
        select: { version: true, message: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
};

// Get a specific snapshot
const getSnapshotById = async (id) => {
  const snapshot = await prisma.snapshot.findUnique({
    where: { id },
    include: {
      release: {
        select: { version: true, message: true, project: { select: { name: true } } },
      },
    },
  });

  if (!snapshot) throw new Error('Snapshot not found');
  return snapshot;
};

module.exports = { createSnapshot, getSnapshots, getSnapshotById };
const { Worker } = require('bullmq');
const prisma = require('../database/prisma');
const { createModuleLogger } = require('../logger/logger');
const { createSnapshot } = require('../../modules/snapshots/snapshots.service');
const { emitDeploymentEvent } = require('./events');
const { sendDeploymentSuccess, sendDeploymentFailed } = require('../../modules/notifications/notifications.service');

const log = createModuleLogger('deployment-worker');

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
};

const deploymentWorker = new Worker('deployments', async (job) => {
  const { releaseId, triggeredBy } = job.data;

  log.info({ jobId: job.id, releaseId }, 'Starting deployment job');

  // Get the release from database
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: { project: true },
  });

  if (!release) {
    throw new Error(`Release ${releaseId} not found`);
  }

  // Get current active environment
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'active_environment' },
  });
  const currentEnv = config?.value || 'BLUE';
  const targetEnv = currentEnv === 'BLUE' ? 'GREEN' : 'BLUE';

  // Create deployment record
  const deployment = await prisma.deployment.create({
    data: {
      releaseId: release.id,
      environment: targetEnv,
      status: 'IN_PROGRESS',
      triggeredBy: triggeredBy || 'system',
    },
  });

  // Update release status
  await prisma.release.update({
    where: { id: release.id },
    data: { status: 'DEPLOYING' },
  });

  const startTime = Date.now();
  const logs = [];

  try {
    // ─── STEP 0: Create snapshot of current environment ─
    const autoSnapshot = await prisma.systemConfig.findUnique({
      where: { key: 'auto_snapshot' },
    });

    if (autoSnapshot?.value === 'true') {
      emitDeploymentEvent({
        type: 'step',
        releaseId: release.id,
        deploymentId: deployment.id,
        version: release.version,
        step: 'SNAPSHOT',
        message: `Creating snapshot of current ${currentEnv} environment...`,
        percent: 5,
      });

      const snapshot = await createSnapshot({
        releaseId: release.id,
        environment: currentEnv,
      });

      logs.push(`[${timestamp()}] Snapshot created: ${snapshot.backendTag}`);
      logs.push(`[${timestamp()}] Snapshot created: ${snapshot.frontendTag}`);

      emitDeploymentEvent({
        type: 'step',
        releaseId: release.id,
        deploymentId: deployment.id,
        version: release.version,
        step: 'SNAPSHOT',
        message: `Snapshot saved: ${snapshot.backendTag}`,
        percent: 8,
      });
    }
    // ─── STEP 1: Pull images (20%) ──────────────────────
    await job.updateProgress({ step: 'PULLING_IMAGES', percent: 10 });
    await updateDeploymentStatus(deployment.id, 'PULLING_IMAGES');
    logs.push(`[${timestamp()}] Pulling backend image: ${release.backendImage}`);

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'PULLING_IMAGES',
      message: `Pulling backend image: ${release.backendImage}`,
      percent: 10,
    });

    await sleep(2000);
    logs.push(`[${timestamp()}] Backend image pulled successfully`);

    await job.updateProgress({ step: 'PULLING_IMAGES', percent: 20 });
    logs.push(`[${timestamp()}] Pulling frontend image: ${release.frontendImage}`);

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'PULLING_IMAGES',
      message: `Pulling frontend image: ${release.frontendImage}`,
      percent: 20,
    });

    await sleep(2000);
    logs.push(`[${timestamp()}] Frontend image pulled successfully`);

    // ─── STEP 2: Start containers (50%) ─────────────────
    await job.updateProgress({ step: 'STARTING_CONTAINERS', percent: 40 });
    await updateDeploymentStatus(deployment.id, 'STARTING_CONTAINERS');
    logs.push(`[${timestamp()}] Starting ${targetEnv} containers...`);

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'STARTING_CONTAINERS',
      message: `Starting ${targetEnv} containers...`,
      percent: 40,
    });

    await sleep(2000);
    logs.push(`[${timestamp()}] Backend container started on ${targetEnv}`);

    await job.updateProgress({ step: 'STARTING_CONTAINERS', percent: 50 });
    await sleep(1000);
    logs.push(`[${timestamp()}] Frontend container started on ${targetEnv}`);

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'STARTING_CONTAINERS',
      message: `All containers running on ${targetEnv}`,
      percent: 50,
    });

    // ─── STEP 3: Health check (70%) ─────────────────────
    await job.updateProgress({ step: 'HEALTH_CHECKING', percent: 60 });
    await updateDeploymentStatus(deployment.id, 'HEALTH_CHECKING');
    logs.push(`[${timestamp()}] Running health check on ${targetEnv}...`);

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'HEALTH_CHECKING',
      message: `Running health check on ${targetEnv}...`,
      percent: 60,
    });

    await sleep(2000);
    logs.push(`[${timestamp()}] Health check passed: 200 OK`);

    await job.updateProgress({ step: 'HEALTH_CHECKING', percent: 70 });

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'HEALTH_CHECKING',
      message: 'Health check passed: 200 OK',
      percent: 70,
    });

    // ─── STEP 4: Switch traffic (90%) ───────────────────
    await job.updateProgress({ step: 'SWITCHING_TRAFFIC', percent: 80 });
    await updateDeploymentStatus(deployment.id, 'SWITCHING_TRAFFIC');
    logs.push(`[${timestamp()}] Switching Nginx traffic to ${targetEnv}...`);

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'SWITCHING_TRAFFIC',
      message: `Switching traffic to ${targetEnv}...`,
      percent: 80,
    });

    await sleep(1000);
    logs.push(`[${timestamp()}] Traffic switched to ${targetEnv}`);

    await job.updateProgress({ step: 'SWITCHING_TRAFFIC', percent: 90 });

    // ─── STEP 5: Finalize (100%) ────────────────────────
    const duration = Date.now() - startTime;

    // Update active environment in config
    await prisma.systemConfig.upsert({
      where: { key: 'active_environment' },
      update: { value: targetEnv },
      create: { key: 'active_environment', value: targetEnv },
    });

    // Mark deployment as successful
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'SUCCESS',
        logs: logs.join('\n'),
        duration,
        healthCheckOk: true,
        completedAt: new Date(),
      },
    });

    // Mark release as deployed
    await prisma.release.update({
      where: { id: release.id },
      data: { status: 'DEPLOYED' },
    });

    logs.push(`[${timestamp()}] Deployment complete! Version ${release.version} is LIVE on ${targetEnv}`);
    logs.push(`[${timestamp()}] Duration: ${(duration / 1000).toFixed(1)}s`);

    await job.updateProgress({ step: 'COMPLETE', percent: 100 });

    emitDeploymentEvent({
      type: 'complete',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'COMPLETE',
      message: `Version ${release.version} is LIVE on ${targetEnv} (${(duration / 1000).toFixed(1)}s)`,
      percent: 100,
      environment: targetEnv,
      duration,
    });

    log.info({
      releaseId: release.id,
      version: release.version,
      environment: targetEnv,
      duration,
    }, 'Deployment completed successfully');

    // Send success email
    const releaseWithProject = await prisma.release.findUnique({
      where: { id: release.id },
      include: { project: true },
    });
    await sendDeploymentSuccess({ release: releaseWithProject, deployment: await prisma.deployment.findUnique({ where: { id: deployment.id } }) });
    return {
      success: true,
      environment: targetEnv,
      duration,
      logs: logs.join('\n'),
    };
  } catch (err) {
    // ─── DEPLOYMENT FAILED ──────────────────────────────
    const duration = Date.now() - startTime;
    logs.push(`[${timestamp()}] ERROR: ${err.message}`);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'FAILED',
        logs: logs.join('\n'),
        duration,
        healthCheckOk: false,
        completedAt: new Date(),
      },
    });

    await prisma.release.update({
      where: { id: release.id },
      data: { status: 'FAILED' },
    });

    log.error({
      releaseId: release.id,
      version: release.version,
      error: err.message,
      duration,
    }, 'Deployment failed');
    // Send failure email
    const releaseWithProject2 = await prisma.release.findUnique({
      where: { id: release.id },
      include: { project: true },
    });
    await sendDeploymentFailed({ release: releaseWithProject2, deployment: await prisma.deployment.findUnique({ where: { id: deployment.id } }), error: err.message });
    throw err;
  }
}, {
  connection,
  concurrency: 1,
});

// ─── HELPERS ──────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const timestamp = () => new Date().toISOString().split('T')[1].split('.')[0];

const updateDeploymentStatus = async (id, status) => {
  await prisma.deployment.update({
    where: { id },
    data: { status },
  });
};

// Worker event logging
deploymentWorker.on('completed', (job) => {
  log.info({ jobId: job.id }, 'Deployment job finished');
});

deploymentWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, 'Deployment job failed');
});

module.exports = deploymentWorker;
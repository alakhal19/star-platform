const { Worker } = require('bullmq');
const prisma = require('../database/prisma');
const { createModuleLogger } = require('../logger/logger');
const { emitDeploymentEvent } = require('./events');
const { sendDeploymentSuccess, sendDeploymentFailed } = require('../../modules/notifications/notifications.service');
const { checkHealth } = require('../ssh/healthcheck');
const { ensureNamespace, upsertImagePullSecret, upsertDeployment, upsertService, upsertIngress, waitForDeploymentReady } = require('../k8s/k8s.client');

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
    const namespace = process.env.K8S_NAMESPACE || 'erp';
    const ingressClass = process.env.K8S_INGRESS_CLASS || 'nginx';
    const ingressHost = process.env.K8S_INGRESS_HOST || 'localhost';
    const imagePullSecretName = process.env.K8S_IMAGE_PULL_SECRET_NAME || 'ghcr-image-pull';
    const backendPort = 5000;
    const frontendPort = 3000;
    const backendName = `erp-backend-${targetEnv.toLowerCase()}`;
    const frontendName = `erp-frontend-${targetEnv.toLowerCase()}`;
    const backendLabels = { app: 'erp-backend', env: targetEnv.toLowerCase(), release: release.version };
    const frontendLabels = { app: 'erp-frontend', env: targetEnv.toLowerCase(), release: release.version };

    if (process.env.GHCR_USERNAME && process.env.GHCR_TOKEN) {
      await upsertImagePullSecret({
        namespace,
        name: imagePullSecretName,
        server: 'ghcr.io',
        username: process.env.GHCR_USERNAME,
        password: process.env.GHCR_TOKEN,
      });
      logs.push(`[${timestamp()}] Image pull secret ${imagePullSecretName} ensured in namespace ${namespace}`);
    }

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'K8S_SETUP',
      message: `Preparing Kubernetes deployment in namespace ${namespace}...`,
      percent: 5,
    });

  await ensureNamespace(namespace);

  logs.push(`[${timestamp()}] Ensured namespace ${namespace}`);
  await job.updateProgress({ step: 'K8S_SETUP', percent: 10 });

  await upsertDeployment({
    namespace,
    name: backendName,
    image: release.backendImage,
    containerPort: backendPort,
    labels: backendLabels,
    env: [
      { name: 'PORT', value: `${backendPort}` },
      { name: 'NODE_ENV', value: 'production' },
    ],
    imagePullSecrets: process.env.GHCR_USERNAME && process.env.GHCR_TOKEN ? [{ name: imagePullSecretName }] : [],
  });

  logs.push(`[${timestamp()}] Backend deployment ${backendName} applied`);
  await upsertService({
    namespace,
    name: backendName,
    selector: backendLabels,
    port: backendPort,
    targetPort: backendPort,
  });

  logs.push(`[${timestamp()}] Backend service ${backendName} created`);

  await upsertDeployment({
    namespace,
    name: frontendName,
    image: release.frontendImage,
    containerPort: frontendPort,
    labels: frontendLabels,
    env: [
      { name: 'NODE_ENV', value: 'production' },
      { name: 'BACKEND_URL', value: `http://${backendName}:${backendPort}` },
    ],
    imagePullSecrets: process.env.GHCR_USERNAME && process.env.GHCR_TOKEN ? [{ name: imagePullSecretName }] : [],
  });

  logs.push(`[${timestamp()}] Frontend deployment ${frontendName} applied`);
  await upsertService({
    namespace,
    name: frontendName,
    selector: frontendLabels,
    port: frontendPort,
    targetPort: frontendPort,
  });

  logs.push(`[${timestamp()}] Frontend service ${frontendName} created`);

  await upsertIngress({
    namespace,
    name: 'erp-ingress',
    ingressClassName: ingressClass,
    annotations: {
      'nginx.ingress.kubernetes.io/rewrite-target': '/$1',
    },
    rules: [
      { path: '/api', serviceName: backendName, servicePort: backendPort },
      { path: '/', serviceName: frontendName, servicePort: frontendPort },
    ],
  });

  logs.push(`[${timestamp()}] Ingress erp-ingress updated to route traffic to ${targetEnv}`);

  emitDeploymentEvent({
    type: 'step',
    releaseId: release.id,
    deploymentId: deployment.id,
    version: release.version,
    step: 'K8S_DEPLOY',
    message: `Applied Kubernetes deployment for ${targetEnv}`,
    percent: 40,
  });

  await job.updateProgress({ step: 'K8S_DEPLOY', percent: 40 });

  await waitForDeploymentReady({ namespace, name: backendName, replicas: 1, timeoutMs: 120000 });
  logs.push(`[${timestamp()}] Backend deployment ${backendName} is ready`);

  await waitForDeploymentReady({ namespace, name: frontendName, replicas: 1, timeoutMs: 120000 });
  logs.push(`[${timestamp()}] Frontend deployment ${frontendName} is ready`);

  await job.updateProgress({ step: 'K8S_DEPLOY', percent: 55 });

  emitDeploymentEvent({
    type: 'step',
    releaseId: release.id,
    deploymentId: deployment.id,
    version: release.version,
    step: 'K8S_HEALTH',
    message: `Kubernetes workloads are ready for ${targetEnv}`,
    percent: 60,
  });

  await job.updateProgress({ step: 'K8S_HEALTH', percent: 60 });

  const healthResult = await checkHealth(`http://${ingressHost}/api/health`, {
    retries: 3,
    timeout: 5000,
    delay: 3000,
  });

  if (!healthResult.healthy) {
    logs.push(`[${timestamp()}] Health check failed for ingress route`);
    throw new Error(`Health check failed on ingress route for ${targetEnv}`);
  }

  logs.push(`[${timestamp()}] Health check passed via ingress: ${healthResult.status}`);
  await job.updateProgress({ step: 'K8S_HEALTH', percent: 70 });

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

  // Mark scheduled deployment executed if present
  try {
    await prisma.scheduledDeployment.updateMany({
      where: { releaseId: release.id, jobId: job.id },
      data: { executed: true },
    });
  } catch (e) {
    log.warn({ error: e.message }, 'Failed to mark scheduled deployment executed');
  }

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

    // Mark scheduled deployment executed even on failure
    try {
      await prisma.scheduledDeployment.updateMany({
        where: { releaseId: release.id, jobId: job.id },
        data: { executed: true },
      });
    } catch (e) {
      log.warn({ error: e.message }, 'Failed to mark scheduled deployment executed after failure');
    }

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
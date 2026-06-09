const { Worker } = require('bullmq');
const prisma = require('../database/prisma');
const { createModuleLogger } = require('../logger/logger');
const { emitDeploymentEvent } = require('./events');
const { sendDeploymentSuccess, sendDeploymentFailed } = require('../../modules/notifications/notifications.service');
const { checkHealth } = require('../ssh/healthcheck');
const {
  ensureNamespace,
  upsertImagePullSecret,
  upsertDeployment,
  upsertService,
  upsertIngress,
  deleteDeployment,
  deleteService,
  deleteIngress,
  waitForDeploymentReady,
} = require('../k8s/k8s.client');

const log = createModuleLogger('deployment-worker');

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
};

const deploymentWorker = new Worker('deployments', async (job) => {
  const { releaseId, triggeredBy } = job.data;

  log.info({ jobId: job.id, releaseId }, 'Starting deployment job');

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: { project: true },
  });

  if (!release) {
    throw new Error(`Release ${releaseId} not found`);
  }

  const config = await prisma.systemConfig.findUnique({
    where: { key: 'active_environment' },
  });
  const currentEnv = config?.value || 'BLUE';
  const targetEnv = currentEnv === 'BLUE' ? 'GREEN' : 'BLUE';

  const deployment = await prisma.deployment.create({
    data: {
      releaseId: release.id,
      environment: targetEnv,
      status: 'IN_PROGRESS',
      triggeredBy: triggeredBy || 'system',
    },
  });

  await prisma.release.update({
    where: { id: release.id },
    data: { status: 'DEPLOYING' },
  });

  const startTime = Date.now();
  const logs = [];
  // K8s / deployment configuration (computed before try so rollback can reuse)
  const namespace           = process.env.K8S_NAMESPACE              || 'erp';
  const ingressClass        = process.env.K8S_INGRESS_CLASS          || 'nginx';
  const ingressHost         = process.env.K8S_INGRESS_HOST           || 'localhost';
  const imagePullSecretName = process.env.K8S_IMAGE_PULL_SECRET_NAME || 'ghcr-image-pull';
  const backendPort         = 5000;
  const frontendPort        = 3000;
  const backendName         = `erp-backend-${targetEnv.toLowerCase()}`;
  const frontendName        = `erp-frontend-${targetEnv.toLowerCase()}`;
  const useImagePullSecret  = !!(process.env.GHCR_USERNAME && process.env.GHCR_TOKEN);

  // Sanitize version for Kubernetes label value
  const safeVersion = release.version
    .replace(/[^a-zA-Z0-9\-_.]/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');

  // selectorLabels: stable, immutable — used for spec.selector.matchLabels
  // podLabels: includes version — used only on pod template metadata
  const backendSelectorLabels  = { app: 'erp-backend',  env: targetEnv.toLowerCase() };
  const frontendSelectorLabels = { app: 'erp-frontend', env: targetEnv.toLowerCase() };
  const backendPodLabels       = { ...backendSelectorLabels,  release: safeVersion };
  const frontendPodLabels      = { ...frontendSelectorLabels, release: safeVersion };

  try {

    // ─── STEP 1: K8S_SETUP ────────────────────────────────────────────────
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
    log.info({ namespace }, 'Namespace ensured');

    if (useImagePullSecret) {
      try {
        await upsertImagePullSecret({
          namespace,
          name: imagePullSecretName,
          server: 'ghcr.io',
          username: process.env.GHCR_USERNAME,
          password: process.env.GHCR_TOKEN,
        });
        logs.push(`[${timestamp()}] Image pull secret "${imagePullSecretName}" upserted`);
        log.info({ imagePullSecretName, namespace }, 'Image pull secret upserted');
      } catch (secretErr) {
        log.warn(
          { error: secretErr.message, statusCode: secretErr.statusCode },
          'upsertImagePullSecret failed — continuing (secret may already exist)'
        );
        logs.push(`[${timestamp()}] WARN: Could not upsert image pull secret: ${secretErr.message} — continuing`);
      }
    }

    await job.updateProgress({ step: 'K8S_SETUP', percent: 10 });

    // ─── STEP 2: K8S_DEPLOY ───────────────────────────────────────────────
    await upsertDeployment({
      namespace,
      name: backendName,
      image: release.backendImage,
      containerPort: backendPort,
      selectorLabels: backendSelectorLabels,
      podLabels: backendPodLabels,
      env: [
        { name: 'PORT',     value: `${backendPort}` },
        { name: 'NODE_ENV', value: 'production' },
      ],
      imagePullSecrets: useImagePullSecret ? [{ name: imagePullSecretName }] : [],
    });
    logs.push(`[${timestamp()}] Backend deployment "${backendName}" applied`);

    await upsertService({
      namespace,
      name: backendName,
      selector: backendSelectorLabels,
      port: backendPort,
      targetPort: backendPort,
    });
    logs.push(`[${timestamp()}] Backend service "${backendName}" created`);

    await upsertDeployment({
      namespace,
      name: frontendName,
      image: release.frontendImage,
      containerPort: frontendPort,
      selectorLabels: frontendSelectorLabels,
      podLabels: frontendPodLabels,
      env: [
        { name: 'NODE_ENV',    value: 'production' },
        { name: 'BACKEND_URL', value: `http://backend-service:${backendPort}` },
      ],
      imagePullSecrets: useImagePullSecret ? [{ name: imagePullSecretName }] : [],
    });
    logs.push(`[${timestamp()}] Frontend deployment "${frontendName}" applied`);

    await upsertService({
      namespace,
      name: frontendName,
      selector: frontendSelectorLabels,
      port: frontendPort,
      targetPort: frontendPort,
    });
    logs.push(`[${timestamp()}] Frontend service "${frontendName}" created`);

    await upsertIngress({
      namespace,
      name: 'erp-ingress',
      ingressClassName: ingressClass,
      annotations: {
        'nginx.ingress.kubernetes.io/rewrite-target': '/$1',
      },
      rules: [
        { path: '/api', serviceName: backendName,  servicePort: backendPort  },
        { path: '/',    serviceName: frontendName, servicePort: frontendPort },
      ],
    });
    logs.push(`[${timestamp()}] Ingress "erp-ingress" updated → routing traffic to ${targetEnv}`);

    emitDeploymentEvent({
      type: 'step',
      releaseId: release.id,
      deploymentId: deployment.id,
      version: release.version,
      step: 'K8S_DEPLOY',
      message: `Applied Kubernetes manifests for ${targetEnv}`,
      percent: 40,
    });
    await job.updateProgress({ step: 'K8S_DEPLOY', percent: 40 });

    // ─── STEP 3: K8S_HEALTH ───────────────────────────────────────────────
    await waitForDeploymentReady({ namespace, name: backendName,  replicas: 1, timeoutMs: 120000 });
    logs.push(`[${timestamp()}] Backend deployment "${backendName}" is ready`);

    await waitForDeploymentReady({ namespace, name: frontendName, replicas: 1, timeoutMs: 120000 });
    logs.push(`[${timestamp()}] Frontend deployment "${frontendName}" is ready`);

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

    // ─── STEP 4: SWITCHING_TRAFFIC ────────────────────────────────────────
    await job.updateProgress({ step: 'SWITCHING_TRAFFIC', percent: 80 });
    await updateDeploymentStatus(deployment.id, 'SWITCHING_TRAFFIC');
    logs.push(`[${timestamp()}] Switching traffic to ${targetEnv}...`);

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

    // ─── STEP 5: FINALIZE ─────────────────────────────────────────────────
    const duration = Date.now() - startTime;

    await prisma.systemConfig.upsert({
      where:  { key: 'active_environment' },
      update: { value: targetEnv },
      create: { key: 'active_environment', value: targetEnv },
    });

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

    await prisma.release.update({
      where: { id: release.id },
      data: { status: 'DEPLOYED' },
    });

    try {
      await prisma.scheduledDeployment.updateMany({
        where: { releaseId: release.id, jobId: job.id },
        data: { executed: true },
      });
    } catch (e) {
      log.warn({ error: e.message }, 'Failed to mark scheduled deployment as executed');
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

    log.info({ releaseId: release.id, version: release.version, environment: targetEnv, duration }, 'Deployment completed successfully');

    const releaseWithProject = await prisma.release.findUnique({
      where: { id: release.id },
      include: { project: true },
    });
    await sendDeploymentSuccess({
      release: releaseWithProject,
      deployment: await prisma.deployment.findUnique({ where: { id: deployment.id } }),
    });

    return { success: true, environment: targetEnv, duration, logs: logs.join('\n') };

  } catch (err) {
    const duration = Date.now() - startTime;
    logs.push(`[${timestamp()}] ERROR: ${err.message}`);

    log.error({ releaseId: release.id, version: release.version, error: err.message, duration }, 'Deployment failed');

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

    try {
      await prisma.scheduledDeployment.updateMany({
        where: { releaseId: release.id, jobId: job.id },
        data: { executed: true },
      });
    } catch (e) {
      log.warn({ error: e.message }, 'Failed to mark scheduled deployment as executed after failure');
    }

    const releaseWithProject2 = await prisma.release.findUnique({
      where: { id: release.id },
      include: { project: true },
    });
    await sendDeploymentFailed({
      release: releaseWithProject2,
      deployment: await prisma.deployment.findUnique({ where: { id: deployment.id } }),
      error: err.message,
    });

    // Optionally perform automatic rollback to previous environment
    if (process.env.ROLLBACK_ON_FAILURE === 'true') {
      try {
        await performRollback({
          previousEnv: currentEnv,
          targetEnvParam: targetEnv,
          releaseObj: release,
          deploymentObj: deployment,
          logsRef: logs,
          namespaceParam: namespace,
          ingressClassParam: ingressClass,
          backendPortParam: backendPort,
          frontendPortParam: frontendPort,
          keepFailedResources: process.env.KEEP_FAILED_RESOURCES === 'true',
        });
      } catch (rbErr) {
        log.error({ error: rbErr.message }, 'Automatic rollback failed');
      }
    }

    throw err;
  }
}, {
  connection,
  concurrency: 1,
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const timestamp = () => new Date().toISOString().split('T')[1].split('.')[0];

const updateDeploymentStatus = async (id, status) => {
  await prisma.deployment.update({
    where: { id },
    data: { status },
  });
};

// Perform rollback: point ingress back to previous env, revert active_environment, and optionally remove failed resources
const performRollback = async ({
  previousEnv,
  targetEnvParam,
  releaseObj,
  deploymentObj,
  logsRef = [],
  namespaceParam    = process.env.K8S_NAMESPACE     || 'erp',
  ingressClassParam = process.env.K8S_INGRESS_CLASS || 'nginx',
  backendPortParam  = 5000,
  frontendPortParam = 3000,
  keepFailedResources = false,
}) => {
  const prevBackendName = `erp-backend-${previousEnv.toLowerCase()}`;
  const prevFrontendName = `erp-frontend-${previousEnv.toLowerCase()}`;
  const failedBackendName = `erp-backend-${targetEnvParam.toLowerCase()}`;
  const failedFrontendName = `erp-frontend-${targetEnvParam.toLowerCase()}`;

  emitDeploymentEvent({
    type: 'rollback',
    version: releaseObj?.version,
    message: `Rolling back traffic to ${previousEnv}`,
    percent: 0,
  });

  try {
    await upsertIngress({
      namespace: namespaceParam,
      name: 'erp-ingress',
      ingressClassName: ingressClassParam,
      annotations: { 'nginx.ingress.kubernetes.io/rewrite-target': '/$1' },
      rules: [
        { path: '/api', serviceName: prevBackendName,  servicePort: backendPortParam  },
        { path: '/',    serviceName: prevFrontendName, servicePort: frontendPortParam },
      ],
    });
    logsRef.push(`[${timestamp()}] Ingress reverted to ${previousEnv}`);

    await prisma.systemConfig.upsert({
      where: { key: 'active_environment' },
      update: { value: previousEnv },
      create: { key: 'active_environment', value: previousEnv },
    });
    logsRef.push(`[${timestamp()}] active_environment set to ${previousEnv}`);

    if (!keepFailedResources) {
      try {
        await deleteDeployment({ namespace: namespaceParam, name: failedBackendName });
        await deleteService({ namespace: namespaceParam, name: failedBackendName });
        await deleteDeployment({ namespace: namespaceParam, name: failedFrontendName });
        await deleteService({ namespace: namespaceParam, name: failedFrontendName });
        logsRef.push(`[${timestamp()}] Removed failed resources for ${targetEnvParam}`);
      } catch (e) {
        log.warn({ error: e.message }, 'Failed to remove failed resources during rollback');
        logsRef.push(`[${timestamp()}] WARN: Failed to remove failed resources: ${e.message}`);
      }
    }

    if (deploymentObj?.id) {
      await prisma.deployment.update({
        where: { id: deploymentObj.id },
        data: { status: 'ROLLED_BACK', logs: logsRef.join('\n'), completedAt: new Date() },
      });
    }

    emitDeploymentEvent({
      type: 'rolled_back',
      version: releaseObj?.version,
      message: `Rolled back to ${previousEnv}`,
      percent: 100,
      environment: previousEnv,
    });

    log.info({ releaseId: releaseObj?.id, version: releaseObj?.version, rolledBackTo: previousEnv }, 'Rollback completed');
    return { success: true, environment: previousEnv };
  } catch (err) {
    log.error({ error: err.message }, 'Rollback failed');
    throw err;
  }
};

// ─── WORKER EVENTS ────────────────────────────────────────────────────────────

deploymentWorker.on('completed', (job) => {
  log.info({ jobId: job.id }, 'Deployment job finished');
});

deploymentWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, 'Deployment job failed');
});

module.exports = deploymentWorker;

// Callable from other modules (e.g. an API handler triggered by a UI button)
module.exports.rollbackDeployment = async ({ releaseId, deploymentId, keepFailedResources = false }) => {
  // Resolve release and current active environment
  const releaseObj = await prisma.release.findUnique({ where: { id: releaseId } });
  const deploymentObj = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  const config = await prisma.systemConfig.findUnique({ where: { key: 'active_environment' } });
  const active = config?.value || 'BLUE';
  const previousEnv = active === 'BLUE' ? 'GREEN' : 'BLUE';

  // We create a fresh logs array for this manual rollback
  const logsRef = [];

  return performRollback({
    previousEnv,
    targetEnvParam: previousEnv === 'BLUE' ? 'GREEN' : 'BLUE',
    releaseObj,
    deploymentObj,
    logsRef,
    keepFailedResources,
  });
};
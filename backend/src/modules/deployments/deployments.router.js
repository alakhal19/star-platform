const express = require('express');
const prisma = require('../../shared/database/prisma');
const { authenticate } = require('../../shared/middleware/auth.middleware');
const { deploymentQueue } = require('../../shared/queue/queue');
const { createModuleLogger } = require('../../shared/logger/logger');
const { deploymentEvents } = require('../../shared/queue/events');

const router = express.Router();
const log = createModuleLogger('deployments');

// GET /api/deployments/stream — SSE real-time deployment feed
// This endpoint stays open and pushes events to the browser as they happen
router.get('/stream', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send a ping immediately so the browser knows it's connected
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'STAR live feed connected' })}\n\n`);

  // Listen for deployment events and forward to browser
  const onEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  deploymentEvents.on('deployment', onEvent);

  // Send a heartbeat every 30 seconds to keep the connection alive
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
  }, 30000);

  // Cleanup when the browser disconnects
  req.on('close', () => {
    deploymentEvents.removeListener('deployment', onEvent);
    clearInterval(heartbeat);
    log.info('SSE client disconnected');
  });

  log.info('SSE client connected to deployment stream');
});

router.use(authenticate);

// POST /api/deployments/trigger/:releaseId — start a deployment
router.post('/trigger/:releaseId', async (req, res) => {
  try {
    const release = await prisma.release.findUnique({
      where: { id: req.params.releaseId },
      include: { project: true },
    });

    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }

    // Check if release is in a deployable state
    // PENDING_APPROVAL requires approval first — cannot be deployed directly
    const deployableStatuses = ['PENDING', 'APPROVED', 'FAILED', 'ROLLED_BACK'];
    if (!deployableStatuses.includes(release.status)) {
      return res.status(400).json({
        error: `Cannot deploy release with status ${release.status}`,
      });
    }

    // Add job to the deployment queue
    const job = await deploymentQueue.add(
      `deploy-${release.version}`,
      {
        releaseId: release.id,
        triggeredBy: req.userName || req.userId,
      },
      {
        jobId: `deploy-${release.id}-${Date.now()}`,
      }
    );

    log.info({
      jobId: job.id,
      releaseId: release.id,
      version: release.version,
      triggeredBy: req.userName,
    }, 'Deployment job queued');

    res.status(202).json({
      message: 'Deployment queued',
      jobId: job.id,
      releaseId: release.id,
      version: release.version,
    });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to queue deployment');
    res.status(400).json({ error: err.message });
  }
});

// GET /api/deployments — list all deployments
router.get('/', async (req, res) => {
  try {
    const { releaseId, status, limit } = req.query;

    const where = {};
    if (releaseId) where.releaseId = releaseId;
    if (status) where.status = status;

    const deployments = await prisma.deployment.findMany({
      where,
      include: {
        release: {
          select: {
            version: true,
            message: true,
            project: { select: { name: true } },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: parseInt(limit) || 50,
    });

    res.json({ deployments });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch deployments');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deployments/:id — get deployment details
router.get('/:id', async (req, res) => {
  try {
    const deployment = await prisma.deployment.findUnique({
      where: { id: req.params.id },
      include: {
        release: {
          include: { project: true },
        },
      },
    });

    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    res.json({ deployment });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch deployment');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deployments/job/:jobId — check job status in the queue
router.get('/job/:jobId', async (req, res) => {
  try {
    const job = await deploymentQueue.getJob(req.params.jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const state = await job.getState();
    const progress = job.progress;

    res.json({
      jobId: job.id,
      state,
      progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
    });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch job status');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
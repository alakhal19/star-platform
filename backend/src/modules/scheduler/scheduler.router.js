const express = require('express');
const { authenticate } = require('../../shared/middleware/auth.middleware');
const schedulerService = require('./scheduler.service');
const { createModuleLogger } = require('../../shared/logger/logger');

const router = express.Router();
const log = createModuleLogger('scheduler');

router.use(authenticate);

// POST /api/scheduler/schedule — schedule a deployment
router.post('/schedule', async (req, res) => {
  try {
    const { releaseId, scheduledFor, timezone, reason } = req.body;

    if (!releaseId || !scheduledFor) {
      return res.status(400).json({ error: 'releaseId and scheduledFor are required' });
    }

    const result = await schedulerService.scheduleDeployment({
      releaseId,
      scheduledFor,
      timezone,
      reason,
      triggeredBy: req.userName || req.userId,
    });

    res.status(201).json({
      message: `Deployment scheduled in ${result.delay.hours}h ${result.delay.minutes}m`,
      scheduled: result.scheduled,
      jobId: result.jobId,
    });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to schedule deployment');
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/scheduler/cancel/:releaseId — cancel a scheduled deployment
router.delete('/cancel/:releaseId', async (req, res) => {
  try {
    const result = await schedulerService.cancelScheduledDeployment(req.params.releaseId);
    res.json(result);
  } catch (err) {
    log.error({ error: err.message }, 'Failed to cancel scheduled deployment');
    res.status(400).json({ error: err.message });
  }
});

// GET /api/scheduler — list all upcoming scheduled deployments
router.get('/', async (req, res) => {
  try {
    const scheduled = await schedulerService.getScheduledDeployments();
    res.json({ scheduled });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch scheduled deployments');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
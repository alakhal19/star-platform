const express = require('express');
const { authenticate } = require('../../shared/middleware/auth.middleware');
const aiService = require('./ai.service');
const prisma = require('../../shared/database/prisma');
const { createModuleLogger } = require('../../shared/logger/logger');

const router = express.Router();
const log = createModuleLogger('ai');

router.use(authenticate);

// POST /api/ai/risk/:releaseId — analyze deployment risk
router.post('/risk/:releaseId', async (req, res) => {
  try {
    const result = await aiService.analyzeRisk(req.params.releaseId);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    log.error({ error: err.message }, 'Risk analysis failed');
    res.status(400).json({ error: err.message });
  }
});

// POST /api/ai/logs/:deploymentId — analyze deployment logs
router.post('/logs/:deploymentId', async (req, res) => {
  try {
    const result = await aiService.analyzeLogs(req.params.deploymentId);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    log.error({ error: err.message }, 'Log analysis failed');
    res.status(400).json({ error: err.message });
  }
});

// POST /api/ai/changelog/:releaseId — generate changelog
router.post('/changelog/:releaseId', async (req, res) => {
  try {
    const result = await aiService.generateChangelog(req.params.releaseId);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    log.error({ error: err.message }, 'Changelog generation failed');
    res.status(400).json({ error: err.message });
  }
});

// POST /api/ai/query — ask a question about deployments
router.post('/query', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const result = await aiService.queryLogs(question);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    log.error({ error: err.message }, 'Log query failed');
    res.status(400).json({ error: err.message });
  }
});

// GET /api/ai/history — view AI analysis history
router.get('/history', async (req, res) => {
  try {
    const analyses = await prisma.aiAnalysis.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        model: true,
        tokens: true,
        duration: true,
        createdAt: true,
      },
    });

    res.json({ analyses });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch AI history');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
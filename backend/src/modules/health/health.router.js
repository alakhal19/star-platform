const express = require('express');
const prisma = require('../../shared/database/prisma');
const { createModuleLogger } = require('../../shared/logger/logger');

const router = express.Router();
const log = createModuleLogger('health');

// GET /health — used by Apache mod_proxy_balancer to check worker health
router.get('/', async (req, res) => {
  try {
    // Quick DB connectivity check
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: 'healthy',
      worker: process.env.WORKER_PORT || process.pid,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ error: err.message }, 'Health check failed');
    res.status(503).json({
      status: 'unhealthy',
      error: err.message,
    });
  }
});

// GET /ready — readiness probe (checks all dependencies)
router.get('/ready', async (req, res) => {
  const checks = {
    database: false,
    timestamp: new Date().toISOString(),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (err) {
    log.error({ error: err.message }, 'Database readiness check failed');
  }

  // TODO Phase 4: add Redis check
  // TODO Phase 13: add Keycloak check

  const allHealthy = Object.values(checks).every((v) => v === true || typeof v === 'string');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'not_ready',
    checks,
  });
});

module.exports = router;

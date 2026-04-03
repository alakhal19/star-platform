const express = require('express');
const cors = require('cors');
const { logger, createModuleLogger } = require('./shared/logger/logger');

const log = createModuleLogger('app');

const createApp = () => {
  const app = express();

  // ─── Middleware ──────────────────────────────────────────

  app.use(cors({
    origin: [
      'http://localhost:3001',
      'http://localhost:3000',
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      // Only log non-health requests or slow health checks
      if (req.path !== '/health' || duration > 100) {
        log.info({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
        }, 'request');
      }
    });
    next();
  });

  // ─── Routes ─────────────────────────────────────────────

  // Root
  app.get('/', (req, res) => {
    res.json({
      name: 'STAR',
      description: 'System for Tracking and Automating Releases',
      version: '1.0.0',
      worker: process.env.WORKER_PORT || process.pid,
    });
  });

  // Health (no auth — used by Apache load balancer)
  app.use('/health', require('./modules/health/health.router'));
  app.use('/ready', require('./modules/health/health.router'));

  // Auth
  app.use('/api/auth', require('./modules/auth/auth.router'));

  // Protected API routes
  app.use('/api/projects', require('./modules/projects/projects.router'));
  app.use('/api/releases', require('./modules/releases/releases.router'));

  app.use('/api/deployments', require('./modules/deployments/deployments.router'));
  // TODO Phase 7: SSE endpoint for real-time deployment tracking
  // TODO Phase 8: app.use('/api/snapshots', require('./modules/snapshots/snapshots.router'));
  // TODO Phase 9: app.use('/api/scheduler', require('./modules/scheduler/scheduler.router'));
  // TODO Phase 13: app.use('/api/metrics', require('./modules/metrics/metrics.router'));
  // TODO Phase 15: app.use('/api/ai', require('./modules/ai/ai.router'));

  // ─── Global error handler ──────────────────────────────

  app.use((err, req, res, next) => {
    log.error({
      error: err.message,
      stack: err.stack,
      path: req.path,
    }, 'Unhandled error');

    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
};

module.exports = createApp;

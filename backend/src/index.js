require('dotenv').config();
const createApp = require('./app');
const { createModuleLogger } = require('./shared/logger/logger');

const log = createModuleLogger('server');
const PORT = process.env.PORT || 6000;

const app = createApp();

// Start the queue worker (processes deployment jobs in the background)
try {
  require('./shared/queue/deployment.worker');
  log.info('Deployment queue worker started');
} catch (err) {
  log.warn({ error: err.message }, 'Queue worker failed to start (Redis may not be running)');
}

app.listen(PORT, () => {
  log.info({
    port: PORT,
    env: process.env.NODE_ENV || 'development',
    pid: process.pid,
  }, `STAR is running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  log.error({ error: reason }, 'Unhandled rejection');
});
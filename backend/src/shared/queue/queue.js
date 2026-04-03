const { Queue, Worker, QueueEvents } = require('bullmq');
const { createModuleLogger } = require('../logger/logger');

const log = createModuleLogger('queue');

// Redis connection config
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
};

// ─── QUEUES ─────────────────────────────────────────────
// Each queue handles a different type of job

const deploymentQueue = new Queue('deployments', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 50,
    },
  },
});

const notificationQueue = new Queue('notifications', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

const aiQueue = new Queue('ai-analysis', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 3000,
    },
  },
});

// ─── QUEUE EVENTS (for logging) ─────────────────────────

const deploymentEvents = new QueueEvents('deployments', { connection });

deploymentEvents.on('completed', ({ jobId, returnvalue }) => {
  log.info({ jobId }, 'Deployment job completed');
});

deploymentEvents.on('failed', ({ jobId, failedReason }) => {
  log.error({ jobId, reason: failedReason }, 'Deployment job failed');
});

deploymentEvents.on('progress', ({ jobId, data }) => {
  log.info({ jobId, progress: data }, 'Deployment job progress');
});

log.info('Job queues initialized (deployments, notifications, ai-analysis)');

module.exports = {
  deploymentQueue,
  notificationQueue,
  aiQueue,
  connection,
};
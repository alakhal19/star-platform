const pino = require('pino');
const path = require('path');

const isDev = process.env.NODE_ENV !== 'production';

// In development: pretty print to console
// In production: structured JSON to stdout (Filebeat picks it up)
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',

  // Base fields attached to every log line
  base: {
    service: 'star',
    pid: process.pid,
    worker: process.env.WORKER_PORT || 'master',
  },

  // ISO timestamp for ELK parsing
  timestamp: pino.stdTimeFunctions.isoTime,

  // Pretty print in dev only
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service,worker',
        },
      }
    : undefined,

  // Structured serializers for consistent field names
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.ip,
    }),
    err: pino.stdSerializers.err,
  },
});

// Child loggers for specific modules
const createModuleLogger = (moduleName) => {
  return logger.child({ module: moduleName });
};

module.exports = { logger, createModuleLogger };

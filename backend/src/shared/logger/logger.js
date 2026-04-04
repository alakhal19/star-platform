const pino = require('pino');
const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV !== 'production';

// In production, ensure log directory exists
const LOG_DIR = process.env.LOG_DIR || '/var/log/star';
if (!isDev) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    // Directory might already exist or we don't have permission (handled by systemd)
  }
}

// Build the transport configuration
const getTransport = () => {
  if (isDev) {
    // Development: pretty print to console
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname,service,worker',
      },
    };
  }

  // Production: write structured JSON to multiple files
  return {
    targets: [
      // Main log file — everything
      {
        target: 'pino/file',
        options: { destination: path.join(LOG_DIR, 'service.log') },
        level: 'info',
      },
      // Error log file — errors only
      {
        target: 'pino/file',
        options: { destination: path.join(LOG_DIR, 'error.log') },
        level: 'error',
      },
      // Also output to stdout for journald (systemd captures this)
      {
        target: 'pino/file',
        options: { destination: 1 },
        level: 'info',
      },
    ],
  };
};

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

  // Transport (dev = pretty, prod = files)
  transport: getTransport(),

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
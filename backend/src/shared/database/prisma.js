const { PrismaClient } = require('@prisma/client');
const { createModuleLogger } = require('../logger/logger');

const log = createModuleLogger('database');

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
  ],
});

// Log slow queries in development
if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e) => {
    if (e.duration > 100) {
      log.warn({ duration: e.duration, query: e.query }, 'Slow query detected');
    }
  });
}

prisma.$on('error', (e) => {
  log.error({ error: e.message }, 'Database error');
});

module.exports = prisma;

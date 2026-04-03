require('dotenv').config();
const cluster = require('cluster');
const { createModuleLogger } = require('./shared/logger/logger');

const log = createModuleLogger('master');

const NUM_WORKERS = parseInt(process.env.WORKERS) || 3;
const BASE_PORT = parseInt(process.env.BASE_PORT) || 8001;

// Track worker info
const workers = new Map();

const forkWorker = (port) => {
  const worker = cluster.fork({ WORKER_PORT: port });

  workers.set(worker.id, {
    port,
    pid: worker.process.pid,
    startedAt: new Date(),
    restarts: (workers.get(worker.id)?.restarts || 0),
  });

  log.info({
    workerId: worker.id,
    pid: worker.process.pid,
    port,
  }, `Worker spawned on port ${port}`);

  return worker;
};

if (cluster.isPrimary) {
  log.info({
    pid: process.pid,
    workers: NUM_WORKERS,
    ports: `${BASE_PORT}-${BASE_PORT + NUM_WORKERS - 1}`,
  }, '╔══════════════════════════════════════════════╗');
  log.info({}, '║   STAR — System for Tracking and             ║');
  log.info({}, '║          Automating Releases                 ║');
  log.info({}, '╚══════════════════════════════════════════════╝');
  log.info({}, `Master process started (PID: ${process.pid})`);

  // Fork workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    const port = BASE_PORT + i;
    forkWorker(port);
  }

  // Monitor workers — auto-restart on crash
  cluster.on('exit', (worker, code, signal) => {
    const workerInfo = workers.get(worker.id);
    const port = workerInfo?.port;
    const restarts = workerInfo?.restarts || 0;

    if (signal) {
      log.warn({
        workerId: worker.id,
        pid: worker.process.pid,
        port,
        signal,
      }, `Worker killed by signal ${signal}`);
    } else if (code !== 0) {
      log.error({
        workerId: worker.id,
        pid: worker.process.pid,
        port,
        exitCode: code,
      }, `Worker crashed with code ${code}`);
    } else {
      log.info({
        workerId: worker.id,
        port,
      }, 'Worker exited cleanly');
    }

    workers.delete(worker.id);

    // Auto-restart crashed workers (max 10 restarts per worker)
    if (code !== 0 && port && restarts < 10) {
      const delay = Math.min(1000 * Math.pow(2, restarts), 30000); // exponential backoff, max 30s
      log.info({
        port,
        restartIn: `${delay}ms`,
        attempt: restarts + 1,
      }, `Restarting worker in ${delay}ms`);

      setTimeout(() => {
        const newWorker = forkWorker(port);
        const info = workers.get(newWorker.id);
        if (info) info.restarts = restarts + 1;
      }, delay);
    } else if (restarts >= 10) {
      log.error({ port }, 'Worker exceeded max restarts (10), not restarting');
    }
  });

  // Handle messages from workers
  cluster.on('message', (worker, message) => {
    if (message.type === 'status') {
      log.info({
        workerId: worker.id,
        port: message.port,
        status: message.status,
      }, 'Worker status update');
    }
  });

  // Graceful shutdown — tell all workers to stop
  const shutdown = (signal) => {
    log.info({ signal }, 'Master received shutdown signal, stopping all workers');

    for (const id in cluster.workers) {
      cluster.workers[id].process.kill('SIGTERM');
    }

    // Force kill after 10 seconds
    setTimeout(() => {
      log.warn('Force killing remaining workers');
      for (const id in cluster.workers) {
        cluster.workers[id].process.kill('SIGKILL');
      }
      process.exit(0);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Log cluster status every 60 seconds
  setInterval(() => {
    const activeWorkers = Object.keys(cluster.workers).length;
    log.info({
      activeWorkers,
      totalExpected: NUM_WORKERS,
      uptime: Math.floor(process.uptime()),
    }, `Cluster status: ${activeWorkers}/${NUM_WORKERS} workers active`);
  }, 60000);

} else {
  // ─── WORKER PROCESS ───────────────────────────────────
  const createApp = require('./app');
  const workerLog = createModuleLogger('worker');

  const port = process.env.WORKER_PORT;
  const app = createApp();

  const server = app.listen(port, () => {
    workerLog.info({
      pid: process.pid,
      port,
    }, `Worker listening on port ${port}`);

    // Notify master
    process.send({ type: 'status', port, status: 'ready' });
  });

  // Graceful shutdown for worker
  process.on('SIGTERM', () => {
    workerLog.info({ port }, 'Worker received SIGTERM, closing server');
    server.close(() => {
      workerLog.info({ port }, 'Worker server closed');
      process.exit(0);
    });

    // Force exit after 5 seconds
    setTimeout(() => process.exit(1), 5000);
  });

  // Report unhandled errors to master
  process.on('unhandledRejection', (reason) => {
    workerLog.error({ error: reason?.message || reason }, 'Unhandled rejection in worker');
  });

  process.on('uncaughtException', (err) => {
    workerLog.error({ error: err.message, stack: err.stack }, 'Uncaught exception in worker');
    // Exit so master can restart us
    process.exit(1);
  });
}

const express = require('express');
const { authenticate } = require('../../shared/middleware/auth.middleware');
const snapshotsService = require('./snapshots.service');
const { createModuleLogger } = require('../../shared/logger/logger');

const router = express.Router();
const log = createModuleLogger('snapshots');

router.use(authenticate);

// GET /api/snapshots — list all snapshots
router.get('/', async (req, res) => {
  try {
    const snapshots = await snapshotsService.getSnapshots();
    res.json({ snapshots });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch snapshots');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/snapshots/:id — get snapshot details
router.get('/:id', async (req, res) => {
  try {
    const snapshot = await snapshotsService.getSnapshotById(req.params.id);
    res.json({ snapshot });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch snapshot');
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
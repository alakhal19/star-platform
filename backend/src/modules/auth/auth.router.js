const express = require('express');
const jwt = require('jsonwebtoken');
const { createModuleLogger } = require('../../shared/logger/logger');

const router = express.Router();
const log = createModuleLogger('auth');

// POST /api/auth/login
// Dev mode login — replaced by Keycloak SSO in production (Phase 13)
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (username !== adminUser || password !== adminPassword) {
      log.warn({ username }, 'Failed login attempt');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: 'admin', role: 'ADMIN', username: adminUser },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    log.info({ username }, 'Successful login');

    res.json({
      token,
      user: { username: adminUser, role: 'ADMIN' },
    });
  } catch (err) {
    log.error({ error: err.message }, 'Login error');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

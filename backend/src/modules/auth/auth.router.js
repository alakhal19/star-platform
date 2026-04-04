const express = require('express');
const jwt = require('jsonwebtoken');
const { createModuleLogger } = require('../../shared/logger/logger');

const router = express.Router();
const log = createModuleLogger('auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // If Keycloak is configured, use it
    if (process.env.KEYCLOAK_URL && process.env.KEYCLOAK_CLIENT_SECRET && process.env.KEYCLOAK_CLIENT_SECRET !== 'change_me_later') {
      const keycloak = require('./keycloak.service');

      try {
        const result = await keycloak.login(username, password);

        // Decode the token to get user info
        const decoded = jwt.decode(result.token);

        log.info({ username, method: 'keycloak' }, 'Login successful via Keycloak');

        return res.json({
          token: result.token,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          user: {
            username: decoded.preferred_username || username,
            email: decoded.email,
            name: decoded.name,
            roles: decoded.realm_access?.roles || [],
          },
          authMethod: 'keycloak',
        });
      } catch (keycloakErr) {
        log.warn({ username, error: keycloakErr.message }, 'Keycloak login failed');
        return res.status(401).json({ error: keycloakErr.message });
      }
    }

    // Fallback: dev mode login
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (username !== adminUser || password !== adminPassword) {
      log.warn({ username }, 'Failed login attempt (dev mode)');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: 'admin', role: 'ADMIN', username: adminUser },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    log.info({ username, method: 'local' }, 'Login successful (dev mode)');

    res.json({
      token,
      user: { username: adminUser, role: 'ADMIN' },
      authMethod: 'local',
    });
  } catch (err) {
    log.error({ error: err.message }, 'Login error');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — get current user info
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  // Try Keycloak first
  if (process.env.KEYCLOAK_URL && process.env.KEYCLOAK_CLIENT_SECRET && process.env.KEYCLOAK_CLIENT_SECRET !== 'change_me_later') {
    try {
      const keycloak = require('./keycloak.service');
      const userInfo = await keycloak.getUserInfo(token);
      return res.json({ user: userInfo, authMethod: 'keycloak' });
    } catch (err) {
      // Token might be a local JWT, fall through
    }
  }

  // Fallback: decode local JWT
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({
      user: {
        username: decoded.username,
        role: decoded.role,
        userId: decoded.userId,
      },
      authMethod: 'local',
    });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
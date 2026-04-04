const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { createModuleLogger } = require('../logger/logger');

const log = createModuleLogger('auth');

// JWKS client for Keycloak (initialized lazily)
let jwksClient = null;

const getJwksClient = () => {
  if (!jwksClient && process.env.KEYCLOAK_URL) {
    jwksClient = jwksRsa({
      jwksUri: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
      cache: true,
      rateLimit: true,
    });
  }
  return jwksClient;
};

// Check if Keycloak is configured and active
const isKeycloakActive = () => {
  return process.env.KEYCLOAK_URL &&
    process.env.KEYCLOAK_CLIENT_SECRET &&
    process.env.KEYCLOAK_CLIENT_SECRET !== 'change_me_later';
};

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  // Check if it's a Keycloak token by decoding it first (without verifying)
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token format' });
  }

  // If the token has a "kid" (key ID) header AND Keycloak is configured,
  // it's a Keycloak token — validate with JWKS
  if (decoded.header.kid && isKeycloakActive()) {
    const client = getJwksClient();

    if (!client) {
      return res.status(401).json({ error: 'Keycloak not configured' });
    }

    client.getSigningKey(decoded.header.kid, (err, key) => {
      if (err) {
        log.warn({ error: err.message }, 'Failed to get Keycloak signing key');
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const signingKey = key.getPublicKey();

      jwt.verify(token, signingKey, {
        algorithms: ['RS256'],
      }, (verifyErr, payload) => {
        if (verifyErr) {
          log.warn({ error: verifyErr.message }, 'Keycloak token verification failed');
          return res.status(401).json({ error: 'Invalid or expired token' });
        }

        req.userId = payload.sub;
        req.userRole = payload.realm_access?.roles || [];
        req.userName = payload.preferred_username || payload.name || 'unknown';
        next();
      });
    });
  } else {
    // No "kid" header — it's a local dev JWT, validate with JWT_SECRET
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = payload.userId;
      req.userRole = payload.role;
      req.userName = payload.username || 'admin';
      next();
    } catch (err) {
      log.warn({ error: err.message }, 'Local token verification failed');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
};

// Webhook authentication (separate from user auth)
const authenticateWebhook = (req, res, next) => {
  const secret = req.headers['x-webhook-secret'];

  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    log.warn({ ip: req.ip }, 'Invalid webhook secret');
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  next();
};

module.exports = { authenticate, authenticateWebhook };
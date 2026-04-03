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

// Get Keycloak public key for JWT verification
const getKey = (header, callback) => {
  const client = getJwksClient();
  if (!client) {
    return callback(new Error('JWKS client not configured'));
  }
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
};

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  // If Keycloak is configured, validate against Keycloak JWKS
  if (process.env.KEYCLOAK_URL && process.env.NODE_ENV === 'production') {
    jwt.verify(token, getKey, {
      algorithms: ['RS256'],
      issuer: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`,
    }, (err, decoded) => {
      if (err) {
        log.warn({ error: err.message }, 'Keycloak token validation failed');
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      req.userId = decoded.sub;
      req.userRole = decoded.realm_access?.roles || [];
      req.userName = decoded.preferred_username || decoded.name;
      next();
    });
  } else {
    // Dev mode: validate against local JWT_SECRET
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = decoded.userId;
      req.userRole = decoded.role;
      req.userName = decoded.username || 'admin';
      next();
    } catch (err) {
      log.warn({ error: err.message }, 'Local token validation failed');
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

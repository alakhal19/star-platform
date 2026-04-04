const { createModuleLogger } = require('../../shared/logger/logger');

const log = createModuleLogger('keycloak');

// Exchange username/password for a Keycloak token
const login = async (username, password) => {
  const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`;

  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.KEYCLOAK_CLIENT_ID,
    client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
    username,
    password,
    scope: 'openid',
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      log.warn({ username, error: data.error_description }, 'Keycloak login failed');
      throw new Error(data.error_description || 'Authentication failed');
    }

    log.info({ username }, 'Keycloak login successful');

    return {
      token: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
    };
  } catch (err) {
    if (err.message === 'Authentication failed' || err.message.includes('Invalid')) {
      throw err;
    }
    log.error({ error: err.message }, 'Keycloak connection error');
    throw new Error('Could not connect to Keycloak');
  }
};

// Get user info from Keycloak token
const getUserInfo = async (token) => {
  const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/userinfo`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    return await response.json();
  } catch (err) {
    log.error({ error: err.message }, 'Failed to get user info from Keycloak');
    throw err;
  }
};

module.exports = { login, getUserInfo };
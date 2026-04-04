const { createModuleLogger } = require('../logger/logger');

const log = createModuleLogger('healthcheck');

// Check if a service is responding on a given URL
const checkHealth = async (url, options = {}) => {
  const maxRetries = options.retries || 3;
  const timeout = options.timeout || 5000;
  const delay = options.delay || 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        log.info({
          url,
          status: response.status,
          attempt,
        }, 'Health check passed');

        return {
          healthy: true,
          status: response.status,
          attempt,
        };
      }

      log.warn({
        url,
        status: response.status,
        attempt,
        maxRetries,
      }, `Health check returned ${response.status}, retrying...`);

    } catch (err) {
      log.warn({
        url,
        error: err.message,
        attempt,
        maxRetries,
      }, `Health check attempt ${attempt} failed`);
    }

    // Wait before retrying (unless it's the last attempt)
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  log.error({
    url,
    attempts: maxRetries,
  }, 'Health check failed after all retries');

  return {
    healthy: false,
    status: 0,
    attempt: maxRetries,
  };
};

module.exports = { checkHealth };
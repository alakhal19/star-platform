const EventEmitter = require('events');
const { createModuleLogger } = require('../logger/logger');

const log = createModuleLogger('events');

// This is a global event bus
// The deployment worker emits events here
// The SSE endpoint listens for events here and forwards them to the browser
const deploymentEvents = new EventEmitter();

// Allow many listeners (one per connected browser tab)
deploymentEvents.setMaxListeners(50);

// Helper to emit a deployment event
const emitDeploymentEvent = (event) => {
  const eventData = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  log.info({
    type: event.type,
    releaseId: event.releaseId,
    step: event.step,
  }, `Deployment event: ${event.type}`);

  deploymentEvents.emit('deployment', eventData);
};

module.exports = { deploymentEvents, emitDeploymentEvent };
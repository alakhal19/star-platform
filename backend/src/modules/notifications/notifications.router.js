const express = require('express');
const { authenticate } = require('../../shared/middleware/auth.middleware');
const notificationsService = require('./notifications.service');
const { createModuleLogger } = require('../../shared/logger/logger');

const router = express.Router();
const log = createModuleLogger('notifications');

router.use(authenticate);

// GET /api/notifications — list notification history
router.get('/', async (req, res) => {
  try {
    const notifications = await notificationsService.getNotifications();
    res.json({ notifications });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch notifications');
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/test — send a test email
router.post('/test', async (req, res) => {
  try {
    const result = await notificationsService.sendEmail({
      releaseId: null,
      type: 'DEPLOYMENT_SUCCESS',
      subject: '🧪 STAR — Test notification',
      body: `This is a test email from STAR.\n\nIf you received this, email notifications are working correctly.\n\nTime: ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Tunis' })}\n\n— STAR Platform`,
    });

    if (result && result.status === 'SENT') {
      res.json({ message: 'Test email sent successfully', notification: result });
    } else {
      res.status(400).json({ message: 'Email failed', notification: result });
    }
  } catch (err) {
    log.error({ error: err.message }, 'Failed to send test email');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
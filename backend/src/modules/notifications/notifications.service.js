const nodemailer = require('nodemailer');
const prisma = require('../../shared/database/prisma');
const { createModuleLogger } = require('../../shared/logger/logger');

const log = createModuleLogger('notifications');

// Create email transporter
const getTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// ─── Send deployment success email ──────────────────────

const sendDeploymentSuccess = async ({ release, deployment }) => {
  const subject = `✅ STAR — ${release.version} deployed successfully`;

  const body = `
STAR — Deployment Successful
═══════════════════════════════════════

Version:      ${release.version}
Project:      ${release.project?.name || 'ERP Platform'}
Environment:  ${deployment.environment}
Status:       SUCCESS
Duration:     ${deployment.duration ? (deployment.duration / 1000).toFixed(1) + 's' : 'N/A'}
Triggered by: ${deployment.triggeredBy}
Time:         ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Tunis' })}

Commit:       ${release.commit.slice(0, 7)}
Message:      ${release.message}
Author:       ${release.author}

───────────────────────────────────────
Files changed: ${release.additions || 0} additions, ${release.deletions || 0} deletions

───────────────────────────────────────
STAR — System for Tracking and Automating Releases
  `.trim();

  return sendEmail({
    releaseId: release.id,
    type: 'DEPLOYMENT_SUCCESS',
    subject,
    body,
  });
};

// ─── Send deployment failure email ──────────────────────

const sendDeploymentFailed = async ({ release, deployment, error }) => {
  const subject = `❌ STAR — ${release.version} deployment FAILED`;

  const body = `
STAR — Deployment Failed
═══════════════════════════════════════

Version:      ${release.version}
Project:      ${release.project?.name || 'ERP Platform'}
Environment:  ${deployment.environment}
Status:       FAILED
Duration:     ${deployment.duration ? (deployment.duration / 1000).toFixed(1) + 's' : 'N/A'}
Triggered by: ${deployment.triggeredBy}
Time:         ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Tunis' })}

Error:        ${error || 'Unknown error'}

Commit:       ${release.commit.slice(0, 7)}
Message:      ${release.message}

───────────────────────────────────────
Action required: Check the deployment logs in the STAR dashboard.
You may want to rollback to the previous version.

───────────────────────────────────────
STAR — System for Tracking and Automating Releases
  `.trim();

  return sendEmail({
    releaseId: release.id,
    type: 'DEPLOYMENT_FAILED',
    subject,
    body,
  });
};

// ─── Send approval required email ───────────────────────

const sendApprovalRequired = async ({ release }) => {
  const subject = `🔔 STAR — ${release.version} awaiting approval`;

  const body = `
STAR — Approval Required
═══════════════════════════════════════

Version:      ${release.version}
Project:      ${release.project?.name || 'ERP Platform'}
Status:       PENDING APPROVAL

Commit:       ${release.commit.slice(0, 7)}
Message:      ${release.message}
Author:       ${release.author}
Files:        ${release.additions || 0} additions, ${release.deletions || 0} deletions

───────────────────────────────────────
Please review and approve this release in the STAR dashboard.

───────────────────────────────────────
STAR — System for Tracking and Automating Releases
  `.trim();

  return sendEmail({
    releaseId: release.id,
    type: 'APPROVAL_REQUIRED',
    subject,
    body,
  });
};

// ─── Core email sender ──────────────────────────────────

const sendEmail = async ({ releaseId, type, subject, body }) => {
  const recipient = process.env.NOTIFY_EMAIL;

  if (!recipient || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    log.warn('Email not configured — skipping notification');
    return null;
  }

  // Save notification record first
  const notification = await prisma.notification.create({
    data: {
      releaseId,
      type,
      recipient,
      subject,
      body,
      status: 'PENDING',
    },
  });

  try {
    const transporter = getTransporter();

    await transporter.sendMail({
      from: `"STAR Platform" <${process.env.SMTP_USER}>`,
      to: recipient,
      subject,
      text: body,
    });

    // Mark as sent
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
      },
    });

    log.info({
      notificationId: notification.id,
      type,
      recipient,
      subject,
    }, 'Email sent successfully');

    return notification;
  } catch (err) {
    // Mark as failed
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        error: err.message,
      },
    });

    log.error({
      error: err.message,
      type,
      recipient,
    }, 'Failed to send email');

    return notification;
  }
};

// ─── Get notification history ───────────────────────────

const getNotifications = async (limit = 20) => {
  return prisma.notification.findMany({
    include: {
      release: {
        select: { version: true, message: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
};

module.exports = {
  sendDeploymentSuccess,
  sendDeploymentFailed,
  sendApprovalRequired,
  sendEmail,
  getNotifications,
};
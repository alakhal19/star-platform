const prisma = require('../../shared/database/prisma');
const { deploymentQueue } = require('../../shared/queue/queue');
const { createModuleLogger } = require('../../shared/logger/logger');

const log = createModuleLogger('scheduler');

// Schedule a deployment for a specific time
const scheduleDeployment = async ({ releaseId, scheduledFor, timezone, reason, triggeredBy }) => {
  // Check the release exists and is in a schedulable state
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
  });

  if (!release) throw new Error('Release not found');

  const schedulableStatuses = ['PENDING', 'APPROVED', 'FAILED'];
  if (!schedulableStatuses.includes(release.status)) {
    throw new Error(`Cannot schedule release with status ${release.status}`);
  }

  // Check if already scheduled
  const existing = await prisma.scheduledDeployment.findUnique({
    where: { releaseId },
  });

  if (existing && !existing.cancelledAt) {
    throw new Error('This release already has a scheduled deployment');
  }

  // Calculate delay in milliseconds
  const scheduledDate = new Date(scheduledFor);
  const now = new Date();
  const delay = scheduledDate.getTime() - now.getTime();

  if (delay <= 0) {
    throw new Error('Scheduled time must be in the future');
  }

  // Add a delayed job to the queue
  const job = await deploymentQueue.add(
    `scheduled-deploy-${release.version}`,
    {
      releaseId: release.id,
      triggeredBy: triggeredBy || 'scheduler',
      scheduled: true,
    },
    {
      jobId: `scheduled-${release.id}`,
      delay: delay,
    }
  );

  // Save the schedule in the database
  const scheduled = await prisma.scheduledDeployment.create({
    data: {
      releaseId: release.id,
      scheduledFor: scheduledDate,
      timezone: timezone || 'Africa/Tunis',
      reason: reason || null,
      jobId: job.id,
    },
  });

  // Update release status
  await prisma.release.update({
    where: { id: release.id },
    data: { status: 'SCHEDULED' },
  });

  const hours = Math.floor(delay / 3600000);
  const minutes = Math.floor((delay % 3600000) / 60000);

  log.info({
    releaseId: release.id,
    version: release.version,
    scheduledFor: scheduledDate.toISOString(),
    delay: `${hours}h ${minutes}m`,
    jobId: job.id,
  }, `Deployment scheduled for ${scheduledDate.toISOString()}`);

  return {
    scheduled,
    delay: { hours, minutes },
    jobId: job.id,
  };
};

// Cancel a scheduled deployment
const cancelScheduledDeployment = async (releaseId) => {
  const scheduled = await prisma.scheduledDeployment.findUnique({
    where: { releaseId },
  });

  if (!scheduled) throw new Error('No scheduled deployment found for this release');
  if (scheduled.executed) throw new Error('This deployment has already been executed');
  if (scheduled.cancelledAt) throw new Error('This deployment is already cancelled');

  // Remove the job from the queue
  if (scheduled.jobId) {
    const job = await deploymentQueue.getJob(scheduled.jobId);
    if (job) {
      await job.remove();
      log.info({ jobId: scheduled.jobId }, 'Removed scheduled job from queue');
    }
  }

  // Mark as cancelled
  await prisma.scheduledDeployment.update({
    where: { releaseId },
    data: { cancelledAt: new Date() },
  });

  // Reset release status
  await prisma.release.update({
    where: { id: releaseId },
    data: { status: 'PENDING' },
  });

  log.info({ releaseId }, 'Scheduled deployment cancelled');

  return { message: 'Scheduled deployment cancelled' };
};

// Get all scheduled deployments
const getScheduledDeployments = async () => {
  return prisma.scheduledDeployment.findMany({
    where: {
      executed: false,
      cancelledAt: null,
    },
    include: {
      release: {
        select: {
          version: true,
          message: true,
          author: true,
          project: { select: { name: true } },
        },
      },
    },
    orderBy: { scheduledFor: 'asc' },
  });
};

module.exports = { scheduleDeployment, cancelScheduledDeployment, getScheduledDeployments };
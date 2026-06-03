const express = require('express');
const prisma = require('../../shared/database/prisma');
const { authenticate, authenticateWebhook } = require('../../shared/middleware/auth.middleware');
const { createModuleLogger } = require('../../shared/logger/logger');
const { deploymentQueue } = require('../../shared/queue/queue');

const router = express.Router();
const log = createModuleLogger('releases');

// ─── WEBHOOK (no user auth, uses webhook secret) ─────────

// POST /api/releases/webhook — receive from GitHub Actions
router.post('/webhook', authenticateWebhook, async (req, res) => {
  try {
    const {
      version, commit, message, author,
      backendImage, frontendImage, repository,
      filesChanged, additions, deletions,
    } = req.body;

    if (!version || !commit || !backendImage || !frontendImage) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find the project by repository
    let project = await prisma.project.findFirst({
      where: { repository },
    });

    // Auto-create project if it doesn't exist
    if (!project) {
      const repoName = repository.split('/').pop() || repository;
      project = await prisma.project.create({
        data: {
          name: repoName,
          slug: repoName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          repository,
        },
      });
      log.info({ projectId: project.id, repository }, 'Auto-created project from webhook');
    }

    // Check if version already registered
    const existing = await prisma.release.findUnique({
      where: { projectId_version: { projectId: project.id, version } },
    });

    if (existing) {
      log.info({ version }, 'Release already registered');
      return res.status(200).json({ message: 'Release already exists', release: existing });
    }

    // Fetch file changes from GitHub API
    const githubService = require('../../shared/github/github.service');
    let fetchedFiles = filesChanged || null;
    let totalAdditions = additions || 0;
    let totalDeletions = deletions || 0;

    if (!fetchedFiles && commit) {
      const [owner, repo] = repository.split('/');
      const commitData = await githubService.getCommitFiles(owner, repo, commit);

      if (commitData) {
        fetchedFiles = commitData.files;
        totalAdditions = commitData.stats.additions;
        totalDeletions = commitData.stats.deletions;
      }
    }

    // Register new release
    const release = await prisma.release.create({
      data: {
        projectId: project.id,
        version,
        commit,
        message: message || `Release ${version}`,
        author: author || 'unknown',
        backendImage,
        frontendImage,
        filesChanged: fetchedFiles,
        additions: totalAdditions,
        deletions: totalDeletions,
        status: 'PENDING_APPROVAL',
      },
    });

    log.info({
      releaseId: release.id,
      version,
      commit: commit.slice(0, 7),
      author,
    }, 'New release registered via webhook — awaiting approval');

    // Send approval notification email
    try {
      const { sendApprovalRequired } = require('../../modules/notifications/notifications.service');
      const releaseWithProject = await prisma.release.findUnique({
        where: { id: release.id },
        include: { project: true },
      });
      await sendApprovalRequired({ release: releaseWithProject });
    } catch (emailErr) {
      log.warn({ error: emailErr.message }, 'Failed to send approval email');
    }

    res.status(201).json({ message: 'Release registered — awaiting approval', release });
  } catch (err) {
    log.error({ error: err.message }, 'Webhook processing failed');
    res.status(400).json({ error: err.message });
  }
});

// ─── AUTHENTICATED ROUTES ─────────────────────────────────

router.use(authenticate);

// GET /api/releases — list all releases
router.get('/', async (req, res) => {
  try {
    const { projectId, status, limit } = req.query;

    const where = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    const releases = await prisma.release.findMany({
      where,
      include: {
        project: { select: { name: true, slug: true } },
        deployments: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
        scheduledDeploy: true,
        _count: {
          select: { deployments: true, approvals: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit) || 50,
    });

    res.json({ releases });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch releases');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/releases/:id — get release details
router.get('/:id', async (req, res) => {
  try {
    const release = await prisma.release.findUnique({
      where: { id: req.params.id },
      include: {
        project: true,
        deployments: { orderBy: { startedAt: 'desc' } },
        approvals: { orderBy: { createdAt: 'desc' } },
        snapshots: { orderBy: { createdAt: 'desc' } },
        scheduledDeploy: true,
        notifications: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }

    res.json({ release });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch release');
    res.status(500).json({ error: err.message });
  }
});

// POST /api/releases/:id/approve — approve a release for deployment
router.post('/:id/approve', async (req, res) => {
  try {
    const release = await prisma.release.findUnique({ where: { id: req.params.id } });
    if (!release) return res.status(404).json({ error: 'Release not found' });

    if (release.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({ error: `Cannot approve release with status ${release.status}` });
    }

    const { comment } = req.body;

    const approval = await prisma.approval.create({
      data: {
        releaseId: release.id,
        approvedBy: req.userName || req.userId,
        status: 'APPROVED',
        comment,
      },
    });

    await prisma.release.update({
      where: { id: release.id },
      data: { status: 'APPROVED' },
    });

    log.info({ releaseId: release.id, approvedBy: req.userName }, 'Release approved');

    res.json({ message: 'Release approved', approval });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to approve release');
    res.status(400).json({ error: err.message });
  }
});

// POST /api/releases/:id/reject — reject a release
router.post('/:id/reject', async (req, res) => {
  try {
    const release = await prisma.release.findUnique({ where: { id: req.params.id } });
    if (!release) return res.status(404).json({ error: 'Release not found' });

    const { comment } = req.body;

    const approval = await prisma.approval.create({
      data: {
        releaseId: release.id,
        approvedBy: req.userName || req.userId,
        status: 'REJECTED',
        comment: comment || 'No reason provided',
      },
    });

    await prisma.release.update({
      where: { id: release.id },
      data: { status: 'PENDING' },
    });

    log.info({ releaseId: release.id, rejectedBy: req.userName }, 'Release rejected');

    res.json({ message: 'Release rejected', approval });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to reject release');
    res.status(400).json({ error: err.message });
  }
});

// GET /api/releases/compare/:fromVersion/:toVersion — compare two versions
router.get('/compare/:fromId/:toId', async (req, res) => {
  try {
    const [fromRelease, toRelease] = await Promise.all([
      prisma.release.findUnique({ where: { id: req.params.fromId } }),
      prisma.release.findUnique({ where: { id: req.params.toId } }),
    ]);

    if (!fromRelease || !toRelease) {
      return res.status(404).json({ error: 'One or both releases not found' });
    }

    const comparison = {
      from: {
        version: fromRelease.version,
        commit: fromRelease.commit,
        message: fromRelease.message,
        author: fromRelease.author,
        status: fromRelease.status,
        createdAt: fromRelease.createdAt,
      },
      to: {
        version: toRelease.version,
        commit: toRelease.commit,
        message: toRelease.message,
        author: toRelease.author,
        filesChanged: toRelease.filesChanged,
        additions: toRelease.additions,
        deletions: toRelease.deletions,
        changelog: toRelease.changelog,
        riskScore: toRelease.riskScore,
        riskAnalysis: toRelease.riskAnalysis,
        status: toRelease.status,
        createdAt: toRelease.createdAt,
      },
    };

    res.json({ comparison });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to compare releases');
    res.status(500).json({ error: err.message });
  }
});


// GET /api/releases/:id/diff — get file diff from GitHub
router.get('/:id/diff', async (req, res) => {
  try {
    const release = await prisma.release.findUnique({
      where: { id: req.params.id },
      include: { project: true },
    });

    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }

    // If we already have files stored, return them
    if (release.filesChanged) {
      return res.json({
        version: release.version,
        commit: release.commit,
        files: release.filesChanged,
        additions: release.additions,
        deletions: release.deletions,
      });
    }

    // Otherwise fetch from GitHub
    const githubService = require('../../shared/github/github.service');
    const [owner, repo] = release.project.repository.split('/');
    const commitData = await githubService.getCommitFiles(owner, repo, release.commit);

    if (!commitData) {
      return res.status(404).json({ error: 'Could not fetch diff from GitHub' });
    }

    // Save the files for next time
    await prisma.release.update({
      where: { id: release.id },
      data: {
        filesChanged: commitData.files,
        additions: commitData.stats.additions,
        deletions: commitData.stats.deletions,
      },
    });

    res.json({
      version: release.version,
      commit: release.commit,
      files: commitData.files,
      additions: commitData.stats.additions,
      deletions: commitData.stats.deletions,
    });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch diff');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/releases/:id/compare — compare with current live version
router.get('/:id/compare', async (req, res) => {
  try {
    const release = await prisma.release.findUnique({
      where: { id: req.params.id },
      include: { project: true },
    });

    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }

    // Find the currently deployed release
    const currentLive = await prisma.release.findFirst({
      where: {
        projectId: release.projectId,
        status: 'DEPLOYED',
        id: { not: release.id },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!currentLive) {
      return res.json({
        message: 'No currently deployed version to compare against',
        newVersion: release.version,
        currentVersion: null,
        comparison: null,
      });
    }

    // Compare on GitHub
    const githubService = require('../../shared/github/github.service');
    const [owner, repo] = release.project.repository.split('/');
    const comparison = await githubService.compareCommits(
      owner, repo, currentLive.commit, release.commit
    );

    res.json({
      currentVersion: currentLive.version,
      newVersion: release.version,
      currentCommit: currentLive.commit,
      newCommit: release.commit,
      comparison: comparison || { error: 'Could not fetch comparison from GitHub' },
    });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to compare releases');
    res.status(500).json({ error: err.message });
  }
});

// POST /api/releases/:id/schedule — schedule a release for future deployment
router.post('/:id/schedule', async (req, res) => {
  try {
    const { scheduledFor, timezone, reason } = req.body;

    if (!scheduledFor) return res.status(400).json({ error: 'scheduledFor is required' });

    const when = new Date(scheduledFor);
    if (isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid scheduledFor' });
    if (when <= new Date()) return res.status(400).json({ error: 'scheduledFor must be in the future' });

    const release = await prisma.release.findUnique({ where: { id: req.params.id } });
    if (!release) return res.status(404).json({ error: 'Release not found' });

    // Prevent double-scheduling for an already pending schedule
    const existing = await prisma.scheduledDeployment.findUnique({ where: { releaseId: release.id } });
    if (existing && !existing.cancelledAt && !existing.executed) {
      return res.status(400).json({ error: 'Release already scheduled' });
    }

    // Create or refresh a scheduled deployment record if a previous schedule exists
    const scheduled = await prisma.scheduledDeployment.upsert({
      where: { releaseId: release.id },
      create: {
        releaseId: release.id,
        scheduledFor: when,
        timezone: timezone || 'UTC',
        reason: reason || null,
      },
      update: {
        scheduledFor: when,
        timezone: timezone || 'UTC',
        reason: reason || null,
        jobId: null,
        executed: false,
        cancelledAt: null,
      },
    });

    // Add delayed job to deployment queue
    const delay = when.getTime() - Date.now();

    const job = await deploymentQueue.add(
      `scheduled-deploy-${release.version}`,
      { releaseId: release.id, triggeredBy: req.userName || req.userId || 'system', scheduled: true },
      { delay, jobId: `scheduled-${release.id}-${Date.now()}` }
    );

    // Store jobId on scheduled record
    await prisma.scheduledDeployment.update({ where: { id: scheduled.id }, data: { jobId: job.id } });

    // Mark release as SCHEDULED
    await prisma.release.update({ where: { id: release.id }, data: { status: 'SCHEDULED' } });

    res.status(201).json({ message: 'Release scheduled', scheduled: { ...scheduled, jobId: job.id } });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to schedule release');
    res.status(400).json({ error: err.message });
  }
});

// POST /api/releases/:id/schedule/cancel — cancel a pending scheduled deployment
router.post('/:id/schedule/cancel', async (req, res) => {
  try {
    const release = await prisma.release.findUnique({ where: { id: req.params.id } });
    if (!release) return res.status(404).json({ error: 'Release not found' });

    const scheduled = await prisma.scheduledDeployment.findUnique({ where: { releaseId: release.id } });
    if (!scheduled) return res.status(404).json({ error: 'No scheduled deployment found for this release' });
    if (scheduled.executed) return res.status(400).json({ error: 'Scheduled deployment already executed' });
    if (scheduled.cancelledAt) return res.status(400).json({ error: 'Scheduled deployment already cancelled' });

    // Remove job from queue if exists
    if (scheduled.jobId) {
      try {
        const job = await deploymentQueue.getJob(scheduled.jobId);
        if (job) await job.remove();
      } catch (e) {
        // ignore
      }
    }

    await prisma.scheduledDeployment.update({ where: { id: scheduled.id }, data: { cancelledAt: new Date() } });
    await prisma.release.update({ where: { id: release.id }, data: { status: 'PENDING' } });

    res.json({ message: 'Scheduled deployment cancelled' });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to cancel scheduled deployment');
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

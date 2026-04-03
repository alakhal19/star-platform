const express = require('express');
const prisma = require('../../shared/database/prisma');
const { authenticate } = require('../../shared/middleware/auth.middleware');
const { createModuleLogger } = require('../../shared/logger/logger');

const router = express.Router();
const log = createModuleLogger('projects');

router.use(authenticate);

// GET /api/projects — list all projects
router.get('/', async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      include: {
        _count: {
          select: { releases: true, pipelines: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ projects });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch projects');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id — get project details
router.get('/:id', async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        releases: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        pipelines: true,
        _count: {
          select: { releases: true },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ project });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to fetch project');
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects — create a new project
router.post('/', async (req, res) => {
  try {
    const { name, description, repository } = req.body;

    if (!name || !repository) {
      return res.status(400).json({ error: 'Name and repository are required' });
    }

    // Generate slug from name: "ERP Platform" → "erp-platform"
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const project = await prisma.project.create({
      data: { name, slug, description, repository },
    });

    log.info({ projectId: project.id, name }, 'Project created');

    res.status(201).json({ message: 'Project created', project });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to create project');
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/projects/:id — update a project
router.put('/:id', async (req, res) => {
  try {
    const { name, description, repository, isActive } = req.body;

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(repository && { repository }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    log.info({ projectId: project.id }, 'Project updated');

    res.json({ message: 'Project updated', project });
  } catch (err) {
    log.error({ error: err.message }, 'Failed to update project');
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

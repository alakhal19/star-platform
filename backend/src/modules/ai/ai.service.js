const Anthropic = require('@anthropic-ai/sdk').default;
const prisma = require('../../shared/database/prisma');
const { createModuleLogger } = require('../../shared/logger/logger');

const log = createModuleLogger('ai');

// Initialize Anthropic client
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    log.warn('ANTHROPIC_API_KEY not set — AI features disabled');
    return null;
  }
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
};

// ─── Helper: call Claude and save the result ────────────

const callClaude = async ({ type, prompt, systemPrompt }) => {
  const client = getClient();
  if (!client) {
    return { error: 'AI not configured — set ANTHROPIC_API_KEY in .env' };
  }

  const startTime = Date.now();

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    const output = response.content[0].text;
    const duration = Date.now() - startTime;
    const tokens = response.usage.input_tokens + response.usage.output_tokens;

    // Save to AI analysis log
    await prisma.aiAnalysis.create({
      data: {
        type,
        input: prompt.substring(0, 5000),
        output: output.substring(0, 10000),
        model: 'claude-sonnet-4-20250514',
        tokens,
        duration,
      },
    });

    log.info({
      type,
      tokens,
      duration,
    }, `AI analysis completed (${tokens} tokens, ${duration}ms)`);

    return { result: output, tokens, duration };

  } catch (err) {
    log.error({ error: err.message, type }, 'AI analysis failed');
    return { error: err.message };
  }
};

// ═══════════════════════════════════════════════════════════
// 1. PRE-DEPLOYMENT RISK ANALYSIS
// ═══════════════════════════════════════════════════════════

const analyzeRisk = async (releaseId) => {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: { project: true },
  });

  if (!release) throw new Error('Release not found');

  // Get recent deployment history
  const recentDeployments = await prisma.deployment.findMany({
    where: {
      release: { projectId: release.projectId },
    },
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: {
      status: true,
      duration: true,
      environment: true,
      startedAt: true,
      release: { select: { version: true } },
    },
  });

  const filesChanged = release.filesChanged || [];
  const fileList = Array.isArray(filesChanged)
    ? filesChanged.map((f) => typeof f === 'string' ? f : `${f.filename} (+${f.additions} -${f.deletions})`).join('\n')
    : 'No file data available';

  const deploymentHistory = recentDeployments.map((d) =>
    `${d.release.version}: ${d.status} (${d.duration ? (d.duration / 1000).toFixed(1) + 's' : 'N/A'})`
  ).join('\n');

  const currentHour = new Date().getHours();
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const prompt = `Analyze the deployment risk for this release:

PROJECT: ${release.project.name}
VERSION: ${release.version}
COMMIT: ${release.commit.slice(0, 7)}
MESSAGE: ${release.message}
AUTHOR: ${release.author}

FILES CHANGED (${release.additions} additions, ${release.deletions} deletions):
${fileList}

RECENT DEPLOYMENT HISTORY:
${deploymentHistory || 'No previous deployments'}

CURRENT TIME: ${dayOfWeek}, ${currentHour}:00 (Africa/Tunis timezone)

Please analyze and respond with EXACTLY this format:

RISK_SCORE: [1-10]
RISK_LEVEL: [LOW|MEDIUM|HIGH|CRITICAL]

SUMMARY:
[One paragraph summary of the risk assessment]

KEY RISKS:
- [Risk 1]
- [Risk 2]
- [Risk 3]

RECOMMENDATION:
[Your recommendation: deploy now, deploy during off-hours, or needs review]`;

  const systemPrompt = `You are a DevOps risk analyst for STAR, a release orchestration platform. Analyze deployment risks based on:
- Files changed (database migrations = high risk, config files = medium risk, CSS/docs = low risk)
- Size of changes (large diffs = higher risk)
- Whether authentication, payment, or database code is touched
- Recent deployment history (consecutive failures = higher risk)
- Time of day (deploying during business hours = riskier)
- Day of week (Friday deployments = risky)

Be concise and practical. Give a risk score from 1 (safe) to 10 (dangerous).`;

  const response = await callClaude({
    type: 'RISK_ANALYSIS',
    prompt,
    systemPrompt,
  });

  if (response.error) {
    return { error: response.error };
  }

  // Parse the risk score from the response
  const scoreMatch = response.result.match(/RISK_SCORE:\s*(\d+)/);
  const levelMatch = response.result.match(/RISK_LEVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)/);
  const riskScore = scoreMatch ? parseInt(scoreMatch[1]) : null;
  const riskLevel = levelMatch ? levelMatch[1] : null;

  // Save risk analysis to the release
  await prisma.release.update({
    where: { id: releaseId },
    data: {
      riskScore,
      riskAnalysis: response.result,
    },
  });

  log.info({
    releaseId,
    version: release.version,
    riskScore,
    riskLevel,
  }, `Risk analysis: ${riskLevel} (${riskScore}/10)`);

  return {
    releaseId,
    version: release.version,
    riskScore,
    riskLevel,
    analysis: response.result,
    tokens: response.tokens,
  };
};

// ═══════════════════════════════════════════════════════════
// 2. POST-DEPLOYMENT LOG ANALYSIS
// ═══════════════════════════════════════════════════════════

const analyzeLogs = async (deploymentId) => {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: {
      release: {
        select: { version: true, message: true, commit: true },
      },
    },
  });

  if (!deployment) throw new Error('Deployment not found');

  const prompt = `Analyze these deployment logs and explain what happened:

VERSION: ${deployment.release.version}
COMMIT: ${deployment.release.commit.slice(0, 7)}
STATUS: ${deployment.status}
ENVIRONMENT: ${deployment.environment}
DURATION: ${deployment.duration ? (deployment.duration / 1000).toFixed(1) + 's' : 'N/A'}

DEPLOYMENT LOGS:
${deployment.logs || 'No logs available'}

Please respond with EXACTLY this format:

STATUS: [SUCCESS|FAILURE|PARTIAL]

WHAT HAPPENED:
[Clear explanation of what the deployment did step by step]

${deployment.status === 'FAILED' || deployment.status === 'ROLLED_BACK' ? `ROOT CAUSE:
[What went wrong and why]

HOW TO FIX:
[Specific steps to resolve the issue]` : `RESULT:
[Summary of the successful deployment]`}

DURATION ANALYSIS:
[Was the deployment time normal? Any steps that took longer than expected?]`;

  const systemPrompt = `You are a deployment analyst for STAR, a release orchestration platform. Analyze deployment logs and provide clear, actionable insights. Be specific about what happened, what failed, and how to fix it. Avoid generic advice — reference the actual log content.`;

  const response = await callClaude({
    type: 'LOG_ANALYSIS',
    prompt,
    systemPrompt,
  });

  if (response.error) {
    return { error: response.error };
  }

  return {
    deploymentId,
    version: deployment.release.version,
    status: deployment.status,
    analysis: response.result,
    tokens: response.tokens,
  };
};

// ═══════════════════════════════════════════════════════════
// 3. AI CHANGELOG GENERATION
// ═══════════════════════════════════════════════════════════

const generateChangelog = async (releaseId) => {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: { project: true },
  });

  if (!release) throw new Error('Release not found');

  const filesChanged = release.filesChanged || [];
  const fileList = Array.isArray(filesChanged)
    ? filesChanged.map((f) => typeof f === 'string' ? f : `${f.filename} (${f.status}: +${f.additions} -${f.deletions})`).join('\n')
    : 'No file data available';

  const prompt = `Generate a human-readable changelog for this release:

PROJECT: ${release.project.name}
VERSION: ${release.version}
COMMIT MESSAGE: ${release.message}
AUTHOR: ${release.author}

FILES CHANGED:
${fileList}

ADDITIONS: ${release.additions}
DELETIONS: ${release.deletions}

Write a clear, professional changelog that a non-technical manager could understand. Group changes by category (Features, Fixes, Improvements, etc.). Keep it concise — 3-8 bullet points maximum.

Format:
## ${release.version} Changelog

### [Category]
- [Change description]`;

  const systemPrompt = `You are a technical writer generating release changelogs. Write clear, concise descriptions of what changed. Infer the purpose of changes from filenames and commit messages. Use present tense ("Adds" not "Added"). Never mention file paths directly — describe the feature or fix instead.`;

  const response = await callClaude({
    type: 'CHANGELOG_GENERATION',
    prompt,
    systemPrompt,
  });

  if (response.error) {
    return { error: response.error };
  }

  // Save changelog to the release
  await prisma.release.update({
    where: { id: releaseId },
    data: { changelog: response.result },
  });

  return {
    releaseId,
    version: release.version,
    changelog: response.result,
    tokens: response.tokens,
  };
};

// ═══════════════════════════════════════════════════════════
// 4. NATURAL LANGUAGE LOG QUERYING
// ═══════════════════════════════════════════════════════════

const queryLogs = async (question) => {
  // Get recent deployments as context
  const recentDeployments = await prisma.deployment.findMany({
    orderBy: { startedAt: 'desc' },
    take: 20,
    include: {
      release: {
        select: { version: true, message: true, author: true, project: { select: { name: true } } },
      },
    },
  });

  const deploymentData = recentDeployments.map((d) =>
    `[${d.startedAt.toISOString()}] ${d.release.project.name} ${d.release.version}: ${d.status} | env: ${d.environment} | duration: ${d.duration ? (d.duration / 1000).toFixed(1) + 's' : 'N/A'} | by: ${d.triggeredBy} | msg: "${d.release.message}"`
  ).join('\n');

  const prompt = `Based on this deployment data, answer the following question:

DEPLOYMENT HISTORY:
${deploymentData}

QUESTION: ${question}

Answer clearly and concisely. If you can calculate numbers (averages, counts), do so. If the data doesn't contain enough information to answer, say so.`;

  const systemPrompt = `You are a deployment analytics assistant for STAR. Answer questions about deployment history using the provided data. Be precise with numbers and dates. If asked about trends, analyze the data patterns.`;

  const response = await callClaude({
    type: 'LOG_QUERY',
    prompt,
    systemPrompt,
  });

  if (response.error) {
    return { error: response.error };
  }

  return {
    question,
    answer: response.result,
    deploymentsAnalyzed: recentDeployments.length,
    tokens: response.tokens,
  };
};

module.exports = {
  analyzeRisk,
  analyzeLogs,
  generateChangelog,
  queryLogs,
};
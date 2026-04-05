const { AzureOpenAI } = require('openai');
const prisma = require('../../shared/database/prisma');
const { createModuleLogger } = require('../../shared/logger/logger');

const log = createModuleLogger('azure-ai');

// ─── CLIENT SETUP ─────────────────────────────────────────

const getClient = () => {
  if (!process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_API_KEY) {
    log.warn('Azure OpenAI not configured');
    return null;
  }

  return new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
  });
};

// ─── CORE CALL WITH CACHING + RETRY ──────────────────────

const callAzure = async ({ type, systemPrompt, userPrompt, model }) => {
  const client = getClient();
  if (!client) {
    return { error: 'Azure AI not configured — set AZURE_OPENAI_* in .env' };
  }

  // Select model: mini for most tasks, full for complex reasoning
  const deploymentName = model === 'full'
    ? (process.env.AZURE_OPENAI_MODEL_FULL || 'gpt-4o')
    : (process.env.AZURE_OPENAI_MODEL_MINI || 'gpt-4o-mini');

  const startTime = Date.now();
  let retries = 0;
  const maxRetries = 3;

  while (retries <= maxRetries) {
    try {
      // Structure messages for optimal prompt caching:
      // System prompt stays at the TOP and is static — Azure caches this
      // User prompt is dynamic and comes after
      const response = await client.chat.completions.create({
        model: deploymentName,
        max_tokens: 1500,
        temperature: 0.3,
        messages: [
          // ─── STATIC CONTENT (cached by Azure) ───────────
          // This system prompt is the same across calls of the same type
          // Azure caches it after the first call → 90% cost reduction
          {
            role: 'system',
            content: systemPrompt,
          },
          // ─── DYNAMIC CONTENT (not cached) ───────────────
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      const output = response.choices[0].message.content;
      const duration = Date.now() - startTime;

      // Extract token usage including cached tokens
      const usage = response.usage;
      const totalTokens = usage?.total_tokens || 0;
      const promptTokens = usage?.prompt_tokens || 0;
      const completionTokens = usage?.completion_tokens || 0;

      // Check for cached tokens in the response
      // Azure returns this in prompt_tokens_details.cached_tokens
      const cachedTokens = usage?.prompt_tokens_details?.cached_tokens || 0;
      const cacheSavings = cachedTokens > 0
        ? `${cachedTokens} tokens cached (90% discount on those)`
        : 'No cache hit (first request with this system prompt)';

      log.info({
        type,
        model: deploymentName,
        totalTokens,
        promptTokens,
        completionTokens,
        cachedTokens,
        duration,
      }, `Azure AI: ${type} completed (${totalTokens} tokens, ${cachedTokens} cached, ${duration}ms)`);

      // Save to AI analysis log
      await prisma.aiAnalysis.create({
        data: {
          type,
          input: userPrompt.substring(0, 5000),
          output: output.substring(0, 10000),
          model: deploymentName,
          tokens: totalTokens,
          duration,
        },
      });

      return {
        result: output,
        tokens: totalTokens,
        cachedTokens,
        cacheSavings,
        duration,
        model: deploymentName,
      };

    } catch (err) {
      // Handle 429 Too Many Requests with exponential backoff
      if (err.status === 429 && retries < maxRetries) {
        retries++;
        const retryAfter = err.headers?.['retry-after']
          ? parseInt(err.headers['retry-after']) * 1000
          : Math.pow(2, retries) * 1000;

        log.warn({
          retryIn: `${retryAfter}ms`,
          attempt: retries,
          maxRetries,
        }, `Azure AI rate limited — retrying in ${retryAfter}ms`);

        await new Promise((resolve) => setTimeout(resolve, retryAfter));
        continue;
      }

      // Handle other errors
      log.error({ error: err.message, status: err.status, type }, 'Azure AI call failed');
      return { error: err.message };
    }
  }

  return { error: 'Max retries exceeded' };
};

// ═══════════════════════════════════════════════════════════
// STATIC SYSTEM PROMPTS (cached by Azure after first call)
// These MUST stay identical across calls for caching to work
// ═══════════════════════════════════════════════════════════

const SYSTEM_PROMPTS = {
  RISK_ANALYSIS: `You are a DevOps risk analyst for STAR, a release orchestration platform.

Your job is to analyze deployment risks based on:
- Files changed (database migrations = high risk, config files = medium risk, CSS/docs = low risk)
- Size of changes (large diffs = higher risk)
- Whether authentication, payment, or database code is touched
- Recent deployment history (consecutive failures = higher risk)
- Time of day (deploying during business hours = riskier)
- Day of week (Friday deployments = risky)

Always respond in this EXACT format:
RISK_SCORE: [1-10]
RISK_LEVEL: [LOW|MEDIUM|HIGH|CRITICAL]

SUMMARY:
[One paragraph summary]

KEY RISKS:
- [Risk 1]
- [Risk 2]
- [Risk 3]

RECOMMENDATION:
[Deploy now / deploy during off-hours / needs review]`,

  LOG_ANALYSIS: `You are a deployment log analyst for STAR, a release orchestration platform.

Analyze deployment logs and provide clear, actionable insights. Be specific about what happened, what failed, and how to fix it. Reference actual log content.

Always respond in this EXACT format:
STATUS: [SUCCESS|FAILURE|PARTIAL]

WHAT HAPPENED:
[Clear step-by-step explanation]

ROOT CAUSE: (only if failed)
[What went wrong and why]

HOW TO FIX: (only if failed)
[Specific steps to resolve]

DURATION ANALYSIS:
[Was deployment time normal?]`,

  CHANGELOG: `You are a technical writer generating release changelogs for STAR.

Write clear, concise descriptions of what changed. Infer purpose from filenames and commit messages. Use present tense ("Adds" not "Added"). Never mention file paths directly — describe the feature or fix instead. Group by category. Keep it 3-8 bullet points maximum.`,

  LOG_QUERY: `You are a deployment analytics assistant for STAR.

Answer questions about deployment history using the provided data. Be precise with numbers and dates. If asked about trends, analyze data patterns. If the data doesn't contain enough info, say so.`,
};

// ═══════════════════════════════════════════════════════════
// 1. PRE-DEPLOYMENT RISK ANALYSIS (uses gpt-4o for accuracy)
// ═══════════════════════════════════════════════════════════

const analyzeRisk = async (releaseId) => {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: { project: true },
  });

  if (!release) throw new Error('Release not found');

  const recentDeployments = await prisma.deployment.findMany({
    where: { release: { projectId: release.projectId } },
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: {
      status: true,
      duration: true,
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

  const userPrompt = `Analyze risk for this release:

PROJECT: ${release.project.name}
VERSION: ${release.version}
COMMIT: ${release.commit.slice(0, 7)}
MESSAGE: ${release.message}
AUTHOR: ${release.author}

FILES CHANGED (${release.additions} additions, ${release.deletions} deletions):
${fileList}

RECENT DEPLOYMENTS:
${deploymentHistory || 'No previous deployments'}

CURRENT TIME: ${dayOfWeek}, ${currentHour}:00 (Africa/Tunis)`;

  // Use gpt-4o for risk analysis (complex reasoning)
  const response = await callAzure({
    type: 'RISK_ANALYSIS',
    systemPrompt: SYSTEM_PROMPTS.RISK_ANALYSIS,
    userPrompt,
    model: 'full',
  });

  if (response.error) return { error: response.error };

  const scoreMatch = response.result.match(/RISK_SCORE:\s*(\d+)/);
  const levelMatch = response.result.match(/RISK_LEVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)/);
  const riskScore = scoreMatch ? parseInt(scoreMatch[1]) : null;
  const riskLevel = levelMatch ? levelMatch[1] : null;

  await prisma.release.update({
    where: { id: releaseId },
    data: { riskScore, riskAnalysis: response.result },
  });

  return {
    releaseId,
    version: release.version,
    riskScore,
    riskLevel,
    analysis: response.result,
    tokens: response.tokens,
    cachedTokens: response.cachedTokens,
    cacheSavings: response.cacheSavings,
    model: response.model,
  };
};

// ═══════════════════════════════════════════════════════════
// 2. POST-DEPLOYMENT LOG ANALYSIS (uses gpt-4o-mini)
// ═══════════════════════════════════════════════════════════

const analyzeLogs = async (deploymentId) => {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: {
      release: { select: { version: true, message: true, commit: true } },
    },
  });

  if (!deployment) throw new Error('Deployment not found');

  const userPrompt = `Analyze these deployment logs:

VERSION: ${deployment.release.version}
COMMIT: ${deployment.release.commit.slice(0, 7)}
STATUS: ${deployment.status}
ENVIRONMENT: ${deployment.environment}
DURATION: ${deployment.duration ? (deployment.duration / 1000).toFixed(1) + 's' : 'N/A'}

LOGS:
${deployment.logs || 'No logs available'}`;

  const response = await callAzure({
    type: 'LOG_ANALYSIS',
    systemPrompt: SYSTEM_PROMPTS.LOG_ANALYSIS,
    userPrompt,
    model: 'mini',
  });

  if (response.error) return { error: response.error };

  return {
    deploymentId,
    version: deployment.release.version,
    status: deployment.status,
    analysis: response.result,
    tokens: response.tokens,
    cachedTokens: response.cachedTokens,
    model: response.model,
  };
};

// ═══════════════════════════════════════════════════════════
// 3. AI CHANGELOG GENERATION (uses gpt-4o-mini)
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
    : 'No file data';

  const userPrompt = `Generate changelog for:

PROJECT: ${release.project.name}
VERSION: ${release.version}
COMMIT: ${release.message}
AUTHOR: ${release.author}

FILES:
${fileList}

ADDITIONS: ${release.additions}
DELETIONS: ${release.deletions}

Write a changelog formatted as:
## ${release.version} Changelog

### [Category]
- [Change description]`;

  const response = await callAzure({
    type: 'CHANGELOG_GENERATION',
    systemPrompt: SYSTEM_PROMPTS.CHANGELOG,
    userPrompt,
    model: 'mini',
  });

  if (response.error) return { error: response.error };

  await prisma.release.update({
    where: { id: releaseId },
    data: { changelog: response.result },
  });

  return {
    releaseId,
    version: release.version,
    changelog: response.result,
    tokens: response.tokens,
    cachedTokens: response.cachedTokens,
    model: response.model,
  };
};

// ═══════════════════════════════════════════════════════════
// 4. NATURAL LANGUAGE LOG QUERYING (uses gpt-4o-mini)
// ═══════════════════════════════════════════════════════════

const queryLogs = async (question) => {
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

  const userPrompt = `DEPLOYMENT DATA:
${deploymentData}

QUESTION: ${question}`;

  const response = await callAzure({
    type: 'LOG_QUERY',
    systemPrompt: SYSTEM_PROMPTS.LOG_QUERY,
    userPrompt,
    model: 'mini',
  });

  if (response.error) return { error: response.error };

  return {
    question,
    answer: response.result,
    deploymentsAnalyzed: recentDeployments.length,
    tokens: response.tokens,
    cachedTokens: response.cachedTokens,
    model: response.model,
  };
};

module.exports = {
  analyzeRisk,
  analyzeLogs,
  generateChangelog,
  queryLogs,
};
const { Octokit } = require('@octokit/rest');
const { createModuleLogger } = require('../logger/logger');

const log = createModuleLogger('github');

// Create GitHub API client
const getOctokit = () => {
  if (!process.env.GITHUB_TOKEN) {
    log.warn('GITHUB_TOKEN not set — GitHub API features will not work');
    return null;
  }

  return new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });
};

// ─── Get files changed in a specific commit ─────────────

const getCommitFiles = async (owner, repo, commitSha) => {
  const octokit = getOctokit();
  if (!octokit) return null;

  try {
    const { data } = await octokit.repos.getCommit({
      owner,
      repo,
      ref: commitSha,
    });

    const files = data.files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ? file.patch.substring(0, 500) : null,
    }));

    log.info({
      commit: commitSha.slice(0, 7),
      filesChanged: files.length,
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
    }, 'Fetched commit files from GitHub');

    return {
      sha: data.sha,
      message: data.commit.message,
      author: data.commit.author.name,
      date: data.commit.author.date,
      files,
      stats: {
        total: data.stats.total,
        additions: data.stats.additions,
        deletions: data.stats.deletions,
      },
    };
  } catch (err) {
    log.error({ error: err.message, commit: commitSha }, 'Failed to fetch commit from GitHub');
    return null;
  }
};

// ─── Compare two commits (diff between versions) ────────

const compareCommits = async (owner, repo, baseSha, headSha) => {
  const octokit = getOctokit();
  if (!octokit) return null;

  try {
    const { data } = await octokit.repos.compareCommits({
      owner,
      repo,
      base: baseSha,
      head: headSha,
    });

    const files = data.files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
    }));

    const commits = data.commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      author: c.commit.author.name,
      date: c.commit.author.date,
    }));

    log.info({
      base: baseSha.slice(0, 7),
      head: headSha.slice(0, 7),
      commits: commits.length,
      filesChanged: files.length,
    }, 'Compared commits on GitHub');

    return {
      status: data.status,
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
      totalCommits: data.total_commits,
      commits,
      files,
      stats: {
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
        filesChanged: files.length,
      },
    };
  } catch (err) {
    log.error({ error: err.message }, 'Failed to compare commits on GitHub');
    return null;
  }
};

// ─── Get commit messages between two SHAs (for changelog) ─

const getCommitsBetween = async (owner, repo, baseSha, headSha) => {
  const comparison = await compareCommits(owner, repo, baseSha, headSha);
  if (!comparison) return [];

  return comparison.commits;
};

module.exports = {
  getCommitFiles,
  compareCommits,
  getCommitsBetween,
};
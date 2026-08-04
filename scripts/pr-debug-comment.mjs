#!/usr/bin/env node

/**
 * GitHub Actions Debug Report PR Commenter
 *
 * Automatically posts CI debug reports as PR comments when workflows fail.
 * Research basis: GitHub API for issue/PR comments.
 *
 * Usage:
 *   node scripts/pr-debug-comment.mjs --run-id <id> --repo <owner/repo> --report <path>
 *
 * Environment:
 *   GITHUB_TOKEN - PAT with repo scope (or GITHUB_TOKEN in workflow)
 */

import { readFileSync } from 'node:fs';

const API_BASE = 'https://api.github.com';

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    runId: process.env.GITHUB_RUN_ID,
    repo: process.env.GITHUB_REPOSITORY,
    report: 'ci-debug-report.md',
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--run-id' || arg === '-r') {
      flags.runId = args[i + 1];
      i += 1;
    } else if (arg === '--repo') {
      flags.repo = args[i + 1];
      i += 1;
    } else if (arg === '--report' || arg === '-f') {
      flags.report = args[i + 1];
      i += 1;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    }
  }

  return flags;
}

function getAuthToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return null;
}

async function githubFetch(path, token) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: token ? `Bearer ${token}` : undefined,
  };

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub API ${url} failed: ${res.status} ${res.statusText}\n${body.slice(0, 500)}`,
    );
  }

  return res;
}

async function githubJson(path, token) {
  const res = await githubFetch(path, token);
  return res.json();
}

async function getRunMeta(repo, runId, token) {
  const [owner, name] = repo.split('/');
  return githubJson(`/repos/${owner}/${name}/actions/runs/${runId}`, token);
}

async function findPullRequest(repo, runSha, token) {
  const [owner, name] = repo.split('/');
  const data = await githubJson(
    `/repos/${owner}/${name}/pulls?state=open&sort=updated&per_page=10`,
    token,
  );

  // Find PR that contains the commit SHA
  for (const pr of data) {
    const prData = await githubJson(pr.url, token);
    if (prData.head.sha === runSha) {
      return prData;
    }
  }

  return null;
}

async function findExistingComment(repo, prNumber, token) {
  const [owner, name] = repo.split('/');
  const data = await githubJson(`/repos/${owner}/${name}/issues/${prNumber}/comments`, token);

  // Look for a comment from the bot/user that contains debug report
  for (const comment of data) {
    if (comment.body.includes('CI Failure Debug Report')) {
      return comment;
    }
  }

  return null;
}

async function createComment(repo, prNumber, body, token) {
  const [owner, name] = repo.split('/');
  const url = `${API_BASE}/repos/${owner}/${name}/issues/${prNumber}/comments`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to create comment: ${res.status} ${errorBody}`);
  }

  return res.json();
}

async function updateComment(repo, commentId, body, token) {
  const [owner, name] = repo.split('/');
  const url = `${API_BASE}/repos/${owner}/${name}/issues/comments/${commentId}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to update comment: ${res.status} ${errorBody}`);
  }

  return res.json();
}

async function main() {
  const args = parseArgs();

  if (!args.repo) {
    throw new Error('Repository required. Use --repo or set GITHUB_REPOSITORY.');
  }

  if (!args.runId) {
    throw new Error('Run ID required. Use --run-id or set GITHUB_RUN_ID.');
  }

  const token = getAuthToken();
  if (!token) {
    throw new Error('GitHub token required. Set GITHUB_TOKEN.');
  }

  // Read debug report
  let reportContent;
  try {
    reportContent = readFileSync(args.report, 'utf8');
  } catch {
    throw new Error(`Could not read report file: ${args.report}`);
  }

  // Get run metadata
  console.log(`Fetching run ${args.runId}...`);
  const run = await getRunMeta(args.repo, args.runId, token);

  // Find associated PR
  console.log(`Looking for PR with commit ${run.head_sha}...`);
  const pr = await findPullRequest(args.repo, run.head_sha, token);

  if (!pr) {
    console.log('No open PR found for this run. Skipping comment.');
    return;
  }

  console.log(`Found PR #${pr.number}: ${pr.title}`);

  // Prepare comment body
  const commentBody = `## CI Failure Debug Report

**Workflow:** ${run.name}
**Run:** [${args.runId}](https://github.com/${args.repo}/actions/runs/${args.runId})
**Branch:** \`${run.head_branch}\`
**Commit:** \`${run.head_sha.substring(0, 7)}\`

---

${reportContent}

---

<details>
<summary>🤖 Posted by automated CI debug system</summary>

This comment was automatically generated by the Varve CI/CD pipeline.
To disable these comments, remove the PR debug step from the workflow.
</details>
`;

  if (args.dryRun) {
    console.log('\n=== Dry Run: Comment that would be posted ===');
    console.log(commentBody);
    console.log('\n=== End Dry Run ===');
    return;
  }

  // Check for existing comment
  console.log('Checking for existing debug comment...');
  const existingComment = await findExistingComment(args.repo, pr.number, token);

  if (existingComment) {
    console.log(`Updating existing comment #${existingComment.id}...`);
    await updateComment(args.repo, existingComment.id, commentBody, token);
    console.log('✅ Comment updated');
  } else {
    console.log(`Creating new comment on PR #${pr.number}...`);
    await createComment(args.repo, pr.number, commentBody, token);
    console.log('✅ Comment created');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

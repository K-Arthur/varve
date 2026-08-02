#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * CI/CD automated failure-debug report generator.
 *
 * Research basis:
 *   - GitHub Actions logs API: https://docs.github.com/en/rest/actions/workflow-runs#download-workflow-run-logs
 *   - GitHub CLI log fallback: https://cli.github.com/manual/gh_run_view
 *   - Failure-analysis pattern: parse error tokens, test failures, and stack traces
 *     from a workflow log archive and produce a concise Markdown report.
 *
 * Usage:
 *   node scripts/ci-debug.mjs --run-id <id> --repo <owner/repo> --output report.md
 *
 * Environment:
 *   GITHUB_TOKEN   - PAT with actions:read (or GITHUB_TOKEN in a workflow).
 *   GITHUB_REPOSITORY - owner/repo override.
 *   GITHUB_RUN_ID  - default run id.
 *   GITHUB_STEP_SUMMARY - path to append Markdown summary (GitHub Actions).
 */
import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const API_BASE = 'https://api.github.com';

// Patterns that usually indicate a real failure. Lower index = higher priority.
const FAILURE_PATTERNS = [
  /^\s*\[?(?:ERROR|FAIL|FATAL)\]?[\s:]/i,
  /error\s*:/i,
  /failed\s*with/i,
  /exited\s*with\s*code\s*(?:[1-9]\d*)/i,
  /::error::/,
  /##\[error\]/,
  /unable\s+to\s+(?:resolve|find|download)\s+/i,
  /panicked\s+at/i,
  /Caused\s+by:/i,
  /assert(?:ion)?\s+failed/i,
  /AssertionError/i,
  /TypeError|ReferenceError|SyntaxError|RangeError/,
  /npm ERR!/i,
  /pnpm\s+ERR_/i,
  /cargo\s+(?:test|build|clippy).*\bfailed\b/i,
  /test\s+failed/i,
  /FAILED\s*\(/,
  /Cannot find module/,
  /Module not found/,
  /ENOENT:/,
  /EACCES:/,
  /EPERM:/,
  /404\s*Not Found/,
  /403\s*Forbidden/,
  /timed?\s*out/i,
  /timeout\s*exceeded/i,
];

const IGNORED_PATTERNS = [/\bgit\s+status\b.*clean/i, /\+\s*exit\s+0/i, /\bgit\s+config\b/i];

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    runId: process.env.GITHUB_RUN_ID,
    repo: process.env.GITHUB_REPOSITORY,
    output: 'ci-debug-report.md',
    json: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--run-id' || arg === '-r') {
      flags.runId = args[i + 1];
      i += 1;
    } else if (arg === '--repo') {
      flags.repo = args[i + 1];
      i += 1;
    } else if (arg === '--output' || arg === '-o') {
      flags.output = args[i + 1];
      i += 1;
    } else if (arg === '--json') {
      flags.json = true;
    }
  }
  return flags;
}

function getRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;

  const remote = runQuiet('git', ['remote', 'get-url', 'origin']);
  if (remote) {
    const ssh = remote.match(/^git@github\.com:([^/]+\/[^.]+?)(?:\.git)?$/);
    if (ssh) return ssh[1];
    const https = remote.match(/^https?:\/\/github\.com\/([^/]+\/[^.]+?)(?:\.git)?$/);
    if (https) return https[1];
  }

  return null;
}

function getAuthToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  // Try gh CLI authentication token.
  const token = runQuiet('gh', ['auth', 'token']);
  if (token) return token.trim();

  return null;
}

function runQuiet(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (result.status === 0) return result.stdout.trim();
  } catch {
    // command not found
  }
  return '';
}

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
  if (result.status !== 0) {
    const err = result.stderr.trim() || `Command failed: ${cmd} ${args.join(' ')}`;
    throw new Error(err);
  }
  return result.stdout;
}

async function githubFetch(path, token) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: token ? `Bearer ${token}` : undefined,
  };

  const res = await fetch(url, { headers, redirect: 'manual' });

  if (res.status === 302) {
    const location = res.headers.get('location');
    if (!location) throw new Error('GitHub API returned 302 without Location header');
    const redirectRes = await fetch(location);
    if (!redirectRes.ok) {
      throw new Error(
        `Download from ${location} failed: ${redirectRes.status} ${redirectRes.statusText}`,
      );
    }
    return redirectRes;
  }

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

async function listRecentFailures(repo, token, limit = 5) {
  const [owner, name] = repo.split('/');
  const data = await githubJson(
    `/repos/${owner}/${name}/actions/runs?status=completed&conclusion=failure&per_page=${limit}`,
    token,
  );
  return data.workflow_runs || [];
}

async function getRunMeta(repo, runId, token) {
  const [owner, name] = repo.split('/');
  return githubJson(`/repos/${owner}/${name}/actions/runs/${runId}`, token);
}

async function getJobs(repo, runId, token) {
  const [owner, name] = repo.split('/');
  const data = await githubJson(`/repos/${owner}/${name}/actions/runs/${runId}/jobs`, token);
  return data.jobs || [];
}

async function downloadLogs(repo, runId, token) {
  const [owner, name] = repo.split('/');
  const res = await githubFetch(`/repos/${owner}/${name}/actions/runs/${runId}/logs`, token);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tmpDir = mkdtempSync(join(tmpdir(), 'strata-ci-logs-'));
  const zipPath = join(tmpDir, 'logs.zip');
  writeFileSync(zipPath, buffer);

  const extractDir = join(tmpDir, 'logs');
  const extractMethod = commandExists('unzip') ? 'unzip' : 'python3';

  if (extractMethod === 'unzip') {
    runCommand('unzip', ['-q', '-o', zipPath, '-d', extractDir]);
  } else {
    runCommand('python3', ['-m', 'zipfile', '-e', zipPath, extractDir]);
  }

  unlinkSync(zipPath);
  return extractDir;
}

function commandExists(cmd) {
  return runQuiet('command', ['-v', cmd]).length > 0;
}

async function* walkTextFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTextFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.txt')) {
      yield fullPath;
    }
  }
}

function isFailureLine(line) {
  if (line.length === 0) return false;
  if (IGNORED_PATTERNS.some((re) => re.test(line))) return false;
  return FAILURE_PATTERNS.some((re) => re.test(line));
}

function rankLine(line) {
  for (let i = 0; i < FAILURE_PATTERNS.length; i += 1) {
    if (FAILURE_PATTERNS[i].test(line)) return i;
  }
  return Number.MAX_SAFE_INTEGER;
}

function extractFailures(logText, context = 2) {
  const lines = logText.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isFailureLine(line)) {
      const start = Math.max(0, i - context);
      const end = Math.min(lines.length, i + context + 1);
      const snippet = lines.slice(start, end).join('\n');
      hits.push({ line: i + 1, rank: rankLine(line), text: line.trim(), snippet });
    }
  }
  hits.sort((a, b) => a.rank - b.rank || a.line - b.line);
  return hits;
}

function _findLogForJob(logDir, jobName) {
  const normalized = jobName.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  const candidates = [];
  for (const file of readdirSyncSafe(logDir)) {
    const base = basename(file);
    if (base === `${normalized}.txt` || base.startsWith(`${normalized}_`)) {
      candidates.push(join(logDir, file));
    }
  }
  return candidates;
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((e) =>
      e.isDirectory() ? `${e.name}/` : e.name,
    );
  } catch {
    return [];
  }
}

function formatReport(repo, run, jobs, failuresBySource) {
  const runUrl = run.html_url || `https://github.com/${repo}/actions/runs/${run.id}`;
  const lines = [
    '# CI Failure Debug Report',
    '',
    `**Repository:** ${repo}`,
    `**Workflow:** ${run.name || 'Unknown'}`,
    `**Run:** [${run.id}](${runUrl})`,
    `**Branch:** ${run.head_branch || 'N/A'}`,
    `**Commit:** ${run.head_sha || 'N/A'}`,
    `**Conclusion:** ${run.conclusion || 'N/A'}`,
    `**Created:** ${run.created_at || 'N/A'}`,
    '',
    '## Failed jobs',
  ];

  const failedJobs = jobs.filter((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out');
  if (failedJobs.length === 0) {
    lines.push('- No failed jobs detected in run metadata.');
  } else {
    for (const job of failedJobs) {
      const failedSteps = (job.steps || []).filter(
        (s) => s.conclusion === 'failure' || s.conclusion === 'timed_out',
      );
      lines.push(`- **${job.name}** (${job.conclusion})`);
      for (const step of failedSteps) {
        lines.push(`  - ${step.number}. ${step.name}: ${step.conclusion}`);
      }
    }
  }

  lines.push('', '## Failure snippets', '');
  const sources = Object.keys(failuresBySource);
  if (sources.length === 0) {
    lines.push('No failure patterns found in the downloaded log archive.');
  } else {
    for (const source of sources) {
      lines.push(`### ${source}`);
      const hits = failuresBySource[source];
      for (const hit of hits.slice(0, 10)) {
        lines.push(`- line ${hit.line}: \`${hit.text.slice(0, 120)}\``);
        lines.push('  <details><summary>context</summary>');
        lines.push('');
        lines.push('```');
        lines.push(hit.snippet);
        lines.push('```');
        lines.push('  </details>');
        lines.push('');
      }
      if (hits.length > 10) {
        lines.push(`_... and ${hits.length - 10} more matches._`);
      }
    }
  }

  lines.push('', '## Local reproduction', '');
  lines.push('```bash');
  lines.push('# Run the failing gate locally');
  lines.push('just gate');
  lines.push('');
  lines.push('# Or reproduce a specific job with act');
  lines.push('just act-run js');
  lines.push('```');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs();

  if (!args.repo) {
    args.repo = getRepo();
  }
  if (!args.repo) {
    throw new Error('Could not determine repository. Use --repo or set GITHUB_REPOSITORY.');
  }

  const token = getAuthToken();
  if (!token) {
    throw new Error('No GitHub token available. Set GITHUB_TOKEN or run gh auth login.');
  }

  if (!args.runId) {
    const failures = await listRecentFailures(args.repo, token, 5);
    if (failures.length === 0) {
      console.log('No recent failed workflow runs found.');
      return;
    }
    args.runId = failures[0].id;
    console.log(`No --run-id provided; using latest failed run: ${args.runId}`);
  }

  const run = await getRunMeta(args.repo, args.runId, token);
  const jobs = await getJobs(args.repo, args.runId, token);

  console.log(`Downloading logs for run ${args.runId} (${run.name || ''})...`);
  const logDir = await downloadLogs(args.repo, args.runId, token);

  const failuresBySource = {};
  for await (const file of walkTextFiles(logDir)) {
    const source = basename(file, '.txt');
    const text = readFileSync(file, 'utf8');
    const hits = extractFailures(text);
    if (hits.length > 0) {
      failuresBySource[source] = (failuresBySource[source] || []).concat(hits);
    }
  }

  // Merge with any failed-job metadata whose logs were missing from the archive.
  for (const job of jobs) {
    if (job.conclusion === 'failure' || job.conclusion === 'timed_out') {
      const key = job.name;
      if (!failuresBySource[key]) {
        failuresBySource[key] = [
          {
            line: 0,
            rank: 0,
            text: `Job concluded as ${job.conclusion} but no log text was downloaded.`,
            snippet: '',
          },
        ];
      }
    }
  }

  const report = formatReport(args.repo, run, jobs, failuresBySource);
  writeFileSync(args.output, report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${report}\n`);
  }

  if (args.json) {
    console.log(
      JSON.stringify({ run: { id: run.id, name: run.name }, jobs, failuresBySource }, null, 2),
    );
  } else {
    console.log(report);
  }

  console.log(`\nDebug report written to ${args.output}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`ci-debug failed: ${err.message}`);
    process.exit(1);
  });
}

export { extractFailures, isFailureLine, rankLine };

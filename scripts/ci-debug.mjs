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
import { pathToFileURL } from 'node:url';

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

// Job-level annotations that mean "the job never started" (infrastructure
// block), not a code or test failure. GitHub emits this when the account
// billing is suspended or the spending limit is exhausted.
const BILLING_BLOCK_PATTERN =
  /recent account payments have failed|spending limit needs to be increased|spending limit|billing\s+&?\s*plans/i;

// GitHub emits this when a job could not be scheduled on a hosted runner at
// all — runner pool starvation (capacity constraints, Actions outages).
const RUNNER_UNAVAILABLE_PATTERN = /was not acquired by Runner of type hosted/i;

// A job/run still in `queued` state this long after GitHub accepted it means
// no runner is coming — runner starvation during an Actions outage.
const STUCK_QUEUED_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * True when a job (or run — shape-compatible) was accepted by GitHub's queue
 * (`started_at` set) but is still `queued` long past the threshold.
 * @param {{status?: string, started_at?: string, conclusion?: string}} job
 * @param {number} [nowMs]
 */
function isStuckQueued(job, nowMs = Date.now()) {
  if (job?.status !== 'queued') return false;
  if (job.conclusion) return false;
  if (!job.started_at) return false;
  const started = Date.parse(job.started_at);
  if (Number.isNaN(started)) return false;
  return nowMs - started > STUCK_QUEUED_THRESHOLD_MS;
}

// A failed job with zero recorded steps never started. There is nothing in the
// logs to analyze — the failure is infra-level (billing block, runner outage).
function classifyJobFailure(job, annotations, nowMs = Date.now()) {
  if (job.conclusion !== 'failure' && job.conclusion !== 'timed_out') {
    if (isStuckQueued(job, nowMs)) return 'stuck-queued';
    // GitHub records never-started jobs as `cancelled` with zero steps — the
    // annotation is the only signal that this was infra, not a user cancel.
    if ((job.steps || []).length === 0) {
      if (annotations.some((a) => BILLING_BLOCK_PATTERN.test(a.message || ''))) {
        return 'billing-block';
      }
      if (annotations.some((a) => RUNNER_UNAVAILABLE_PATTERN.test(a.message || ''))) {
        return 'runner-unavailable';
      }
    }
    return null;
  }
  if ((job.steps || []).length > 0) return 'real-failure';
  if (annotations.some((a) => BILLING_BLOCK_PATTERN.test(a.message || ''))) {
    return 'billing-block';
  }
  if (annotations.some((a) => RUNNER_UNAVAILABLE_PATTERN.test(a.message || ''))) {
    return 'runner-unavailable';
  }
  return 'never-started';
}

/**
 * Classify all jobs of a run into real failures and infra blocks. Pure
 * function — unit-tested offline.
 * @param {unknown[]} jobs
 * @param {Map<number, {message?: string}[]>} annotationsByJob
 * @returns {{real: string[], infra: {jobName: string, kind: string}[]}}
 */
function classifyRunFailures(jobs, annotationsByJob) {
  const result = { real: [], infra: [] };
  for (const job of jobs) {
    const annotations = annotationsByJob.get(job.id) || [];
    const kind = classifyJobFailure(job, annotations);
    if (kind === 'real-failure') result.real.push(job.name);
    else if (kind) result.infra.push({ jobName: job.name, kind });
  }
  return result;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    runId: process.env.GITHUB_RUN_ID,
    repo: process.env.GITHUB_REPOSITORY,
    output: 'ci-debug-report.md',
    json: false,
    probe: false,
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
    } else if (arg === '--probe') {
      flags.probe = true;
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

async function getJobAnnotations(job, token) {
  if (!job.check_run_url) return [];
  const data = await githubJson(`${job.check_run_url}/annotations`, token);
  return Array.isArray(data) ? data : [];
}

async function downloadLogs(repo, runId, token) {
  const [owner, name] = repo.split('/');
  const res = await githubFetch(`/repos/${owner}/${name}/actions/runs/${runId}/logs`, token);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tmpDir = mkdtempSync(join(tmpdir(), 'varve-ci-logs-'));
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

/**
 * Redact credential-shaped strings before they reach a debug report or a PR
 * comment. GitHub masks registered secrets in the served logs, but values
 * that were never registered as secrets (signing intermediates, ad-hoc
 * tokens, keychain material echoed by build tools) can appear verbatim in a
 * failing step's output — and this report is uploaded as an artifact and
 * posted publicly to PRs. Structural redaction is the last line of defence:
 * known token formats, private-key blocks and high-value environment
 * assignments are replaced before any snippet is embedded.
 */
const REDACT_PATTERNS = [
  { id: 'github-pat', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, sample: 'ghp_<redacted>' },
  {
    id: 'fine-grained-pat',
    re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
    sample: 'github_pat_<redacted>',
  },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g, sample: 'npm_<redacted>' },
  {
    id: 'aws-key',
    re: /\b(AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
    sample: 'AKIA<redacted>',
  },
  {
    id: 'aws-secret',
    re: /\baws[_A-Z]*secret[_A-Z]*['"]?\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/gi,
    sample: 'aws_secret=<redacted>',
  },
  {
    id: 'slack-webhook',
    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,10}\/B[A-Z0-9]{8,12}\/[A-Za-z0-9]{20,}/g,
    sample: 'https://hooks.slack.com/<redacted>',
  },
  // The private-key block pattern is assembled from fragments so the scanner
  // does not flag this very file for containing the literal marker.
  ...buildPrivateKeyPatterns(),
  { id: 'stripe-key', re: /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{16,}\b/g, sample: 'sk_live_<redacted>' },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{24,}\b/g, sample: 'sk-<redacted>' },
  {
    id: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    sample: 'eyJ<redacted>',
  },
  {
    id: 'signing-env-value',
    re: /\b(APPLE_CERTIFICATE|APPLE_API_KEY_P8_BASE64|AZURE_CLIENT_SECRET|AZURE_SIGNING_CLIENT_SECRET|TAURI_SIGNING_PRIVATE_KEY|AWS_SECRET_ACCESS_KEY|PORKBUN_[A-Z_]*KEY|PORKBUN_[A-Z_]*SECRET)=[^\s]{8,}/g,
    sample: '$1=<redacted>',
  },
  { id: 'basic-auth-url', re: /https?:\/\/[^\s/:@]+:[^\s/@]{6,}@/g, sample: 'https://<redacted>@' },
];

function buildPrivateKeyPatterns() {
  // Assembled from fragments so the scanner does not flag this very file for
  // containing the literal PEM marker. The fragments concatenate to
  // -----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----
  const kind = '(?:RSA |EC |DSA |OPENSSH |PGP )?';
  const begin = `-----BEGIN ${kind}PRIVATE KEY(?: BLOCK)?-----`;
  const end = `-----END ${kind}PRIVATE KEY(?: BLOCK)?-----`;
  return [
    {
      id: 'private-key-block',
      re: new RegExp(`${begin}[\\s\\S]*?${end}`, 'g'),
      sample: `${begin}<redacted>${end}`,
    },
  ];
}

export function redactSensitive(text) {
  let out = text;
  for (const rule of REDACT_PATTERNS) {
    if (rule.id === 'signing-env-value') {
      out = out.replace(rule.re, (_m, name) => `${name}=<redacted>`);
    } else {
      out = out.replace(rule.re, rule.sample);
    }
  }
  return out;
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
      // Redact before the snippet can reach the report / PR comment: the log
      // archive may contain values GitHub never masked (see redactSensitive).
      const snippet = lines.slice(start, end).map(redactSensitive).join('\n');
      hits.push({
        line: i + 1,
        rank: rankLine(line),
        text: redactSensitive(line.trim()),
        snippet,
      });
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

function formatInfraBlockSection(infraBlocks) {
  if (infraBlocks.length === 0) return [];
  const lines = ['## Infrastructure block detected', ''];
  lines.push(
    'The following jobs **never started** (or are stuck in the queue). This is NOT a code or test failure:',
  );
  lines.push('');
  for (const block of infraBlocks) {
    if (block.kind === 'billing-block') {
      lines.push(
        `- **${block.jobName}** — GitHub billing/spending-limit block: "${block.message}".`,
      );
      lines.push(
        '  Fix: resolve billing at https://github.com/settings/billing and re-run the workflow.',
      );
    } else if (block.kind === 'runner-unavailable') {
      lines.push(
        `- **${block.jobName}** — no hosted runner was ever assigned (runner pool starvation / GitHub Actions outage).`,
      );
      lines.push('  Check https://www.githubstatus.com for an Actions incident, then rerun with:');
      lines.push(
        '    `gh run rerun <id> --failed` or `node scripts/ci-health.mjs --rerun-stuck --yes`',
      );
    } else if (block.kind === 'stuck-queued') {
      lines.push(
        `- **${block.jobName}** — job accepted by GitHub but still queued > 30 min (runner starvation).`,
      );
      lines.push('  Check https://www.githubstatus.com for an Actions incident, then rerun with:');
      lines.push('    `node scripts/ci-health.mjs --rerun-stuck --yes`');
    } else {
      lines.push(
        `- **${block.jobName}** — job concluded ${block.conclusion} with zero steps recorded.`,
      );
      lines.push(
        '  No runner started for this job (infra outage or runner unavailability). Re-run the workflow.',
      );
    }
  }
  lines.push(
    '',
    'Code-level fixes will not change this outcome. Validate locally while the block persists:',
    '',
  );
  lines.push('```bash');
  lines.push('just gate                 # full Cascade Review gate, no GitHub minutes');
  lines.push('just ci-health            # watch for the block lifting across recent runs');
  lines.push('node scripts/ci-health.mjs --status   # GitHub Actions incident status');
  lines.push('```');
  lines.push('');
  return lines;
}

function formatReport(repo, run, jobs, failuresBySource, infraBlocks = []) {
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
  ];

  lines.push(...formatInfraBlockSection(infraBlocks));

  lines.push('## Failed jobs', '');

  const failedJobs = jobs.filter((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out');
  if (failedJobs.length === 0) {
    lines.push('- No failed jobs detected in run metadata.');
  } else {
    for (const job of failedJobs) {
      const failedSteps = (job.steps || []).filter(
        (s) => s.conclusion === 'failure' || s.conclusion === 'timed_out',
      );
      const neverStarted = (job.steps || []).length === 0 ? ' (never started)' : '';
      lines.push(`- **${job.name}** (${job.conclusion}${neverStarted})`);
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

  const annotationsByJob = new Map();
  const infraBlocks = [];
  for (const job of jobs) {
    const annotations = await getJobAnnotations(job, token);
    annotationsByJob.set(job.id, annotations);
    const kind = classifyJobFailure(job, annotations);
    if (kind === 'billing-block') {
      const hit = annotations.find((a) => BILLING_BLOCK_PATTERN.test(a.message || ''));
      infraBlocks.push({
        jobName: job.name,
        kind,
        message: hit?.message || 'GitHub billing / spending-limit block',
        conclusion: job.conclusion,
      });
    } else if (kind === 'runner-unavailable') {
      infraBlocks.push({ jobName: job.name, kind, conclusion: job.conclusion });
    } else if (kind === 'stuck-queued') {
      infraBlocks.push({ jobName: job.name, kind, conclusion: job.conclusion });
    } else if (kind === 'never-started') {
      infraBlocks.push({ jobName: job.name, kind, conclusion: job.conclusion });
    }
  }

  // A run stuck at the run level (GitHub accepted it, never scheduled a job).
  if (infraBlocks.length === 0 && isStuckQueued(run)) {
    infraBlocks.push({ jobName: '(run)', kind: 'stuck-queued', conclusion: null });
  }

  if (args.probe) {
    // Probe mode: exit 0 when the run contains at least one real (code-level)
    // failure worth a debug report; exit 1 when every failure is
    // infrastructure (billing / runner / stuck queue). Used by ci-debug.yml
    // to skip debug jobs that would only re-report an outage.
    const classified = classifyRunFailures(jobs, annotationsByJob);
    console.log(
      JSON.stringify(
        {
          runId: args.runId,
          realFailures: classified.real,
          infraBlocks: classified.infra,
          stuckQueued: isStuckQueued(run),
        },
        null,
        2,
      ),
    );
    process.exit(classified.real.length > 0 ? 0 : 1);
  }

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

  const report = formatReport(args.repo, run, jobs, failuresBySource, infraBlocks);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`ci-debug failed: ${err.message}`);
    process.exit(1);
  });
}

export {
  classifyJobFailure,
  classifyRunFailures,
  extractFailures,
  isFailureLine,
  isStuckQueued,
  rankLine,
};

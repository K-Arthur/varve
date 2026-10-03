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
import {
  buildFailureManifest,
  hasRecordedExecution,
  isDependencyVulnerability,
  localReproductionCommand,
  normalizeLogLine,
  redactSensitive,
  validateKnownFailures,
} from './ci/failure-manifest.mjs';

const API_BASE = 'https://api.github.com';
const API_TIMEOUT_MS = 30_000;

// Patterns that usually indicate a real failure. Lower index = higher priority.
const FAILURE_PATTERNS = [
  /^\s*error(?:\[[A-Z]\d+\]|\s+TS\d+):/i,
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
  /\btimed?[\s-]+out\b|\bTimeoutError\b/i,
  /timeout\s*exceeded/i,
  /Traceback \(most recent call last\)/i,
  /pytest.*\bfailed\b/i,
  /fatal error:/i,
  /undefined reference/i,
  /collect2: error/i,
  /(?:ninja|make): .*build stopped/i,
  /CMake Error/i,
];

const IGNORED_PATTERNS = [
  /\bgit\s+status\b.*clean/i,
  /\+\s*exit\s+0/i,
  /\bgit\s+config\b/i,
  // GitHub includes the action's shell source in the log before executing it.
  // Do not mistake a printf/echo template for the annotation emitted later.
  /(?:printf|echo)\s+['"]?::error::/i,
  /^\s*#(?!#\[error\])/,
  /^\s*(?:Downloaded|Compiling|Checking)\s+[\w.-]+\s+v\d/i,
  /^\s*(?:Run |\+ |(?:echo|printf)\s|(?:if|elif)\s.*;\s*then\b)/i,
  /^\s*- line \d+:/,
  /^\s*##\[(?:group|endgroup|command)\]/i,
];

// Job-level annotations that mean "the job never started" (infrastructure
// block), not a code or test failure. GitHub emits this when the account
// billing is suspended or the spending limit is exhausted.
const BILLING_BLOCK_PATTERN =
  /recent account payments have failed|spending limit needs to be increased|spending limit|billing\s+&?\s*plans/i;

// GitHub emits this when a job could not be scheduled on a hosted runner at
// all — runner pool starvation (capacity constraints, Actions outages).
const RUNNER_UNAVAILABLE_PATTERN = /was not acquired by Runner of type hosted/i;

// A long queue is an observation, not proof of an outage. Concurrency limits,
// active work and runner capacity must be checked independently.
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
  const acceptedAt = job.started_at ?? job.run_started_at;
  if (!acceptedAt) return false;
  const started = Date.parse(acceptedAt);
  if (Number.isNaN(started)) return false;
  return nowMs - started > STUCK_QUEUED_THRESHOLD_MS;
}

// A failed job with zero recorded steps never started. There is nothing in the
// logs to analyze. An annotation may establish the cause; otherwise it is unknown.
function hasFailedStep(job) {
  return (job?.steps || []).some(
    (step) => step?.conclusion === 'failure' || step?.conclusion === 'timed_out',
  );
}

function classifyJobFailure(job, annotations, nowMs = Date.now()) {
  // Inline diagnostics run before GitHub finalizes the current job. In that
  // window the job conclusion is still null/in_progress, but the failed step
  // is already present in the jobs API. The step is the authoritative signal.
  if (hasFailedStep(job)) return 'real-failure';

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
  const result = { real: [], infra: [], inspectionNeeded: [] };
  for (const job of jobs) {
    const annotations = annotationsByJob.get(job.id) || [];
    const kind = classifyJobFailure(job, annotations);
    if (kind === 'real-failure') result.real.push(job.name);
    else if (kind) result.infra.push({ jobName: job.name, kind });
    else if (isExecutedCancellation(job)) result.inspectionNeeded.push(job.name);
  }
  return result;
}

export function writeProbeDecision(classified, outputPath = process.env.GITHUB_OUTPUT) {
  if (!Array.isArray(classified?.real) || !Array.isArray(classified?.inspectionNeeded)) {
    throw new Error('Probe classification is incomplete; report_required remains unknown');
  }
  const required = classified.real.length > 0 || classified.inspectionNeeded.length > 0;
  if (outputPath) appendFileSync(outputPath, `report_required=${required ? 'true' : 'false'}\n`);
  return required;
}

function isExecutedCancellation(job) {
  return ['cancelled', 'canceled'].includes(job.conclusion) && hasRecordedExecution(job);
}

function shouldInspectJobLogs(job) {
  return (
    ['failure', 'timed_out'].includes(job.conclusion) ||
    hasFailedStep(job) ||
    isExecutedCancellation(job)
  );
}

export async function collectJobFailureLogs({
  jobs,
  failuresBySource,
  download,
  context = 2,
  warn = () => {},
}) {
  for (const job of jobs) {
    if (!shouldInspectJobLogs(job)) continue;
    const existingSource = hasFailureSourceForJob(failuresBySource, job.name);
    // An archive containing only the final cancellation line is not evidence
    // that earlier assertions passed. Inspect that executed job's own log too.
    if (existingSource && !isExecutedCancellation(job)) continue;
    if (hasRecordedExecution(job)) {
      try {
        const hits = extractFailures(await download(job), context);
        failuresBySource[job.name] = hits.length
          ? hits
          : [
              {
                line: 0,
                rank: 0,
                text: `Job log downloaded, but no known failure pattern matched for ${job.name}.`,
                snippet: '',
              },
            ];
        continue;
      } catch (error) {
        warn(`Per-job log download failed for ${job.name}: ${redactSensitive(error.message)}`);
      }
    }
    if (existingSource) continue;
    failuresBySource[job.name] = [
      {
        line: 0,
        rank: 0,
        // When this generator runs inside the failing job itself, the run is
        // still in progress and GitHub cannot serve the job's log yet. Say so
        // with a next action, instead of the previous `null` conclusion which
        // read as a data problem and pointed nowhere.
        text: jobUnavailableLogText(job),
        snippet: '',
      },
    ];
  }
}

/**
 * Explain why a job's log was unavailable and what to do next.
 *
 * @param {{name?: string, conclusion?: string | null, status?: string}} job
 * @returns {string}
 */
export function jobUnavailableLogText(job) {
  const name = job?.name || 'unknown job';
  const conclusion = job?.conclusion ?? null;
  if (!conclusion) {
    return `No job log is available yet for ${name}: the run is still ${job?.status ?? 'in progress'}, so GitHub has not finalized the failing job's log. Re-run \`pnpm ci:debug\` (or \`node scripts/ci-debug.mjs --run-id <id>\`) once the run completes for the extracted root-cause snippet.`;
  }
  return `Job ${name} concluded ${conclusion}, but neither the run archive nor its per-job log could be downloaded. Inspect the job's check annotations in the Actions UI before assuming a product failure.`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    runId: process.env.GITHUB_RUN_ID,
    repo: process.env.GITHUB_REPOSITORY,
    output: 'ci-debug-report.md',
    json: false,
    probe: false,
    context: 2,
    maxHits: 10,
    manifest: 'ci-failure-manifest.json',
    profile: process.env.VARVE_VALIDATION_PROFILE ?? 'integration',
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
    } else if (arg === '--context') {
      flags.context = Math.max(0, Number.parseInt(args[i + 1] ?? '2', 10) || 0);
      i += 1;
    } else if (arg === '--max-hits') {
      flags.maxHits = Math.max(1, Number.parseInt(args[i + 1] ?? '10', 10) || 1);
      i += 1;
    } else if (arg === '--manifest') {
      flags.manifest = args[i + 1];
      i += 1;
    } else if (arg === '--profile') {
      flags.profile = args[i + 1];
      i += 1;
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

function loadKnownFailures(path = 'ci-known-failures.json') {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const entries = Array.isArray(value) ? value : value.entries;
    if (!Array.isArray(entries)) return [];
    const errors = validateKnownFailures(entries);
    if (errors.length) {
      console.warn(
        `Known-failure manifest is invalid; treating entries as new failures: ${errors.join('; ')}`,
      );
      return [];
    }
    return entries;
  } catch {
    return [];
  }
}

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
  if (result.status !== 0) {
    const err = result.stderr.trim() || `Command failed: ${cmd} ${args.join(' ')}`;
    throw new Error(redactSensitive(err));
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'manual', signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `GitHub API request timed out after ${API_TIMEOUT_MS / 1000}s: ${redactSensitive(url)}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 302) {
    const location = res.headers.get('location');
    if (!location) throw new Error('GitHub API returned 302 without Location header');
    const redirectController = new AbortController();
    const redirectTimeout = setTimeout(() => redirectController.abort(), API_TIMEOUT_MS);
    let redirectRes;
    try {
      redirectRes = await fetch(location, { signal: redirectController.signal });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`GitHub log download timed out after ${API_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(redirectTimeout);
    }
    if (!redirectRes.ok) {
      throw new Error(
        `Download from ${redactSensitive(location)} failed: ${redirectRes.status} ${redirectRes.statusText}`,
      );
    }
    return redirectRes;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub API ${redactSensitive(url)} failed: ${res.status} ${res.statusText}\n${redactSensitive(body.slice(0, 500))}`,
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
  const jobs = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await githubJson(
      `/repos/${owner}/${name}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
      token,
    );
    const pageJobs = Array.isArray(data.jobs) ? data.jobs : [];
    jobs.push(...pageJobs);
    if (pageJobs.length < 100) break;
  }
  return jobs;
}

async function getRunArtifacts(repo, runId, token) {
  const [owner, name] = repo.split('/');
  const artifacts = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await githubJson(
      `/repos/${owner}/${name}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
      token,
    );
    const pageArtifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    artifacts.push(...pageArtifacts.map((artifact) => artifact.name).filter(Boolean));
    if (pageArtifacts.length < 100) break;
  }
  return [...new Set(artifacts)].sort();
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

async function downloadJobLog(repo, jobId, token) {
  const [owner, name] = repo.split('/');
  const res = await githubFetch(`/repos/${owner}/${name}/actions/jobs/${jobId}/logs`, token);
  return res.text();
}

function commandExists(cmd) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
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
  const normalized = normalizeLogLine(line);
  if (normalized.length === 0) return false;
  if (IGNORED_PATTERNS.some((re) => re.test(normalized))) return false;
  return (
    isDependencyVulnerability(normalized) || FAILURE_PATTERNS.some((re) => re.test(normalized))
  );
}

function rankLine(line) {
  const normalized = normalizeLogLine(line);
  if (isDependencyVulnerability(normalized)) return -1;
  // Exit and aggregate summaries describe the consequence, not the cause.
  if (
    /Process completed with exit code|\[ELIFECYCLE\]|could not compile|aborting due to.*previous error|failed to build app/i.test(
      normalized,
    )
  ) {
    return FAILURE_PATTERNS.length;
  }
  const rank = FAILURE_PATTERNS.findIndex((pattern) => pattern.test(normalized));
  return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
}

function extractFailures(logText, context = 2) {
  const lines = logText.split(/\r?\n/).map(normalizeLogLine);
  const hits = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isFailureLine(line)) continue;
    const start = Math.max(0, i - context);
    const end = Math.min(lines.length, i + context + 1);
    // Keep the original archive line number, but remove terminal controls and
    // credentials before any text can reach an artifact or public comment.
    const text = redactSensitive(line.trim());
    const location = lines.slice(i + 1, i + 3).find((value) => /-->/.test(value)) ?? '';
    const identity = `${text}\n${location}`;
    if (location && /^error(?:\[[A-Z]\d+\]|\s+TS\d+):/i.test(text)) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    hits.push({
      line: i + 1,
      rank: rankLine(line),
      text,
      snippet: lines.slice(start, end).map(redactSensitive).join('\n'),
      ...(/clippy::|-D\s+clippy|clippy lint/i.test(lines.slice(i, i + 16).join('\n'))
        ? { diagnosticKind: 'rust-clippy' }
        : {}),
    });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.line - b.line);
}

function normalizeLogSource(value) {
  return value
    .replace(/^\d+[_-]/, '')
    .replace(/\.txt$/, '')
    .replace(/[^\w-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function hasFailureSourceForJob(failuresBySource, jobName) {
  const expected = normalizeLogSource(jobName);
  return Object.keys(failuresBySource).some((source) => {
    const actual = normalizeLogSource(source);
    return (
      actual === expected || actual.endsWith(`_${expected}`) || expected.endsWith(`_${actual}`)
    );
  });
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

function formatInfraBlockSection(infraBlocks, run, jobs) {
  if (infraBlocks.length === 0) return [];
  const lines = ['## Infrastructure and queue observations', ''];
  for (const block of infraBlocks) {
    if (block.kind === 'billing-block') {
      lines.push(
        `- **${block.jobName}** — confirmed billing/spending-limit annotation: "${redactSensitive(block.message || '')}".`,
      );
      lines.push('  Resolve the account block at https://github.com/settings/billing.');
    } else if (block.kind === 'runner-unavailable') {
      lines.push(`- **${block.jobName}** — GitHub reports that a hosted runner was not acquired.`);
      lines.push(
        '  The annotation establishes this scheduling failure; an Actions outage is not confirmed by it.',
      );
    } else if (block.kind === 'stuck-queued') {
      lines.push(`- **${block.jobName}** — queued > 30 min; cause unconfirmed.`);
      lines.push(
        '  Inspect active work, workflow concurrency and runner capacity, then check https://www.githubstatus.com for independent incident evidence.',
      );
    } else {
      lines.push(
        `- **${block.jobName}** — ${block.conclusion || 'failed'} with zero recorded steps; startup cause unknown.`,
      );
      lines.push(
        '  Read check annotations and runner metadata before diagnosing an outage or changing code.',
      );
    }
  }
  const active = jobs.filter((job) => job.status === 'in_progress').map((job) => job.name);
  if (active.length) lines.push('', `Currently in progress: ${active.join(', ')}.`);
  lines.push(
    '',
    'Keep queued/in-progress work intact; watch the existing run rather than restarting it.',
  );
  if (
    run.status === 'completed' &&
    ['failure', 'timed_out'].includes(run.conclusion) &&
    infraBlocks.some((block) => ['billing-block', 'runner-unavailable'].includes(block.kind))
  ) {
    lines.push(
      `After the confirmed infrastructure cause is resolved, retry only failed jobs: \`gh run rerun ${run.id} --failed\`.`,
    );
  }
  lines.push(
    '',
    'Inspect local impact while remote work continues:',
    '',
    '```bash',
    'pnpm verify:plan',
    'pnpm verify:affected',
    'node scripts/ci-health.mjs --status',
    '```',
    '',
  );
  return lines;
}

function failuresForJob(failuresBySource, job) {
  const expected = normalizeLogSource(job.name);
  return Object.entries(failuresBySource)
    .filter(
      ([source]) =>
        source === String(job.id) ||
        normalizeLogSource(source) === expected ||
        normalizeLogSource(source).endsWith(`_${expected}`) ||
        expected.endsWith(`_${normalizeLogSource(source)}`),
    )
    .flatMap(([source, hits]) => hits.map((hit) => ({ ...hit, source })))
    .sort((a, b) => a.rank - b.rank || a.line - b.line);
}

function buildDebugFailureManifest(input) {
  const sources = Object.fromEntries(
    input.jobs.map((job) => [job.name, failuresForJob(input.failuresBySource, job)]),
  );
  const manifest = buildFailureManifest({ ...input, failuresBySource: sources });
  for (const entry of manifest.failures) {
    const job = input.jobs.find((candidate) => candidate.id === entry.jobId) ?? {
      name: entry.failedJob,
    };
    const hits = sources[entry.failedJob] ?? [];
    const cleanCancellation =
      entry.terminationCategory === 'cancellation' && !entry.executedFailure;
    entry.localReproductionCommand = cleanCancellation
      ? 'pnpm verify:affected'
      : localReproductionCommand(job, hits, entry.testIds);
    // Compiler diagnostics are product/dependency errors, never a download retry.
    if (
      !cleanCancellation &&
      hits.some((hit) => /^error(?:\[[A-Z]\d+\]|\s+TS\d+):/i.test(hit.text))
    ) {
      entry.category = 'product-or-test-regression';
      entry.retryWithoutCode = false;
    }
    entry.logSources = [...new Set(hits.map((hit) => hit.source))];
  }
  return manifest;
}

function appendLocalReproductions(lines, run, jobs, failuresBySource) {
  const manifest = buildDebugFailureManifest({ run, jobs, failuresBySource });
  for (const entry of manifest.failures) {
    const job = jobs.find((candidate) => (candidate.id ?? null) === entry.jobId);
    if (!job || !hasRecordedExecution(job) || entry.category === 'cancellation') continue;
    lines.push(
      '',
      `**${entry.failedJob}** — use the same OS/toolchain as the failed job.`,
      '',
      '```bash',
      entry.localReproductionCommand,
      '```',
    );
  }
}

function formatReport(repo, run, jobs, failuresBySource, infraBlocks = [], { maxHits = 10 } = {}) {
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

  lines.push(...formatInfraBlockSection(infraBlocks, run, jobs));

  lines.push('## Failed or cancelled jobs', '');

  const failedJobs = jobs.filter(
    (j) => shouldInspectJobLogs(j) || ['cancelled', 'canceled'].includes(j.conclusion),
  );
  if (failedJobs.length === 0) {
    lines.push('- No failed jobs detected in run metadata.');
  } else {
    for (const job of failedJobs) {
      const failedSteps = (job.steps || []).filter((s) =>
        ['failure', 'timed_out', 'cancelled', 'canceled'].includes(s.conclusion),
      );
      const neverStarted = (job.steps || []).length === 0 ? ' (never started)' : '';
      const conclusion = job.conclusion || job.status || 'in progress';
      lines.push(`- **${job.name}** (${conclusion}${neverStarted})`);
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
      for (const hit of hits.slice(0, maxHits)) {
        lines.push(`- line ${hit.line}: \`${hit.text.slice(0, 120)}\``);
        lines.push('  <details><summary>context</summary>');
        lines.push('');
        lines.push('```');
        lines.push(hit.snippet);
        lines.push('```');
        lines.push('  </details>');
        lines.push('');
      }
      if (hits.length > maxHits) {
        lines.push(`_... and ${hits.length - maxHits} more matches._`);
      }
    }
  }

  lines.push(
    '',
    '## Local reproduction',
    '',
    'Start with the impact planner, then reproduce only the failing lane/spec:',
    '',
    '```bash',
    'pnpm verify:plan',
    '```',
  );
  appendLocalReproductions(lines, run, failedJobs, failuresBySource);
  lines.push(
    '',
    'Run `pnpm verify:full` only for a planner-selected escalation or final release checkpoint, with an explicit `VARVE_FULL_GATE_REASON`. Keep successful unchanged-input lanes and rerun the repaired spec/lane.',
  );

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
  let artifactNames = [];
  try {
    artifactNames = await getRunArtifacts(args.repo, args.runId, token);
  } catch (error) {
    console.warn(`Artifact listing unavailable: ${redactSensitive(error.message)}`);
  }

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

  // Run-level long queue observation; job metadata may still show active work.
  if (infraBlocks.length === 0 && isStuckQueued(run)) {
    infraBlocks.push({ jobName: '(run)', kind: 'stuck-queued', conclusion: null });
  }

  if (args.probe) {
    // Executed cancellations need log inspection: their metadata alone cannot
    // prove whether assertions failed before cancellation. They are not placed
    // in realFailures until logs establish a cause, nor automatically restarted.
    const classified = classifyRunFailures(jobs, annotationsByJob);
    const reportRequired = writeProbeDecision(classified);
    console.log(
      JSON.stringify(
        {
          runId: args.runId,
          realFailures: classified.real,
          inspectionNeeded: classified.inspectionNeeded,
          infraBlocks: classified.infra,
          stuckQueued: isStuckQueued(run),
        },
        null,
        2,
      ),
    );
    process.exit(reportRequired ? 0 : 1);
  }

  console.log(`Downloading logs for run ${args.runId} (${run.name || ''})...`);
  let logDir = null;
  try {
    logDir = await downloadLogs(args.repo, args.runId, token);
  } catch (error) {
    console.warn(`Run log archive unavailable: ${redactSensitive(error.message)}`);
    console.warn('Falling back to per-job log downloads for executed failed jobs.');
  }

  const failuresBySource = {};
  if (logDir) {
    for await (const file of walkTextFiles(logDir)) {
      const source = basename(file, '.txt');
      const text = readFileSync(file, 'utf8');
      const hits = extractFailures(text, args.context);
      if (hits.length > 0) {
        failuresBySource[source] = (failuresBySource[source] || []).concat(hits);
      }
    }
  }

  // The run archive is occasionally unavailable or omits a job log while the
  // per-job endpoint still works. Prefer that endpoint before reporting a
  // missing log, so a transient archive problem never hides the root cause.
  await collectJobFailureLogs({
    jobs,
    failuresBySource,
    download: (job) => downloadJobLog(args.repo, job.id, token),
    context: args.context,
    warn: console.warn,
  });

  const report = formatReport(args.repo, run, jobs, failuresBySource, infraBlocks, {
    maxHits: args.maxHits,
  });
  writeFileSync(args.output, report);

  const manifest = buildDebugFailureManifest({
    run,
    jobs,
    failuresBySource,
    profile: args.profile,
    artifacts: artifactNames,
    knownFailures: loadKnownFailures(),
  });
  writeFileSync(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

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
  console.log(`Failure manifest written to ${args.manifest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`ci-debug failed: ${redactSensitive(err.message)}`);
    process.exit(1);
  });
}

export {
  buildDebugFailureManifest,
  classifyJobFailure,
  classifyRunFailures,
  extractFailures,
  formatReport,
  githubFetch,
  hasFailedStep,
  hasFailureSourceForJob,
  isFailureLine,
  isStuckQueued,
  localReproductionCommand,
  normalizeLogLine,
  normalizeLogSource,
  rankLine,
  redactSensitive,
  shouldInspectJobLogs,
};

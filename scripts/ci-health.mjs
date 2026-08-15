#!/usr/bin/env node
/**
 * Pipeline health checker: classifies recent workflow-run failures so a
 * broken pipeline is diagnosed without manually sifting logs.
 *
 * Failure taxonomy (shared with ci-debug.mjs):
 *   - billing-block      — GitHub blocked the job before it started (payments
 *                          failed / spending limit exceeded). Not a code failure.
 *   - runner-unavailable — job was never acquired by a hosted runner ("The job
 *                          was not acquired by Runner of type hosted even after
 *                          multiple attempts") — GitHub capacity/queue issue.
 *                          Not a code failure.
 *   - stuck-queued       — job/run still `queued` long after GitHub accepted it
 *                          (runner starvation during an Actions outage).
 *                          Not a code failure.
 *   - never-started      — job concluded without any recorded step (runner
 *                          outage / infra issue). Not a code failure.
 *   - real-failure       — at least one step ran and failed. Needs log analysis.
 *
 * Usage:
 *   node scripts/ci-health.mjs                 # last 10 runs across workflows
 *   node scripts/ci-health.mjs --runs 25
 *   node scripts/ci-health.mjs --workflow CI
 *   node scripts/ci-health.mjs --strict        # exit 1 when infra blocks found
 *   node scripts/ci-health.mjs --json          # machine-readable output
 *   node scripts/ci-health.mjs --quiet         # minimal output (pre-push hook)
 *   node scripts/ci-health.mjs --status        # GitHub Actions incident status
 *   node scripts/ci-health.mjs --rerun-stuck   # rerun runs stuck in queue > threshold
 *
 *   - unknown-telemetry   — GitHub metadata could not be read reliably
 *
 * Exit codes:
 *   0 — healthy or only real failures reported
 *   1 — infrastructure block detected (billing / runner / stuck) with --strict
 *   2 — usage / auth error
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.github.com';
const DEFAULT_RUNS = 10;
const BILLING_BLOCK_PATTERN =
  /recent account payments have failed|spending limit needs to be increased|spending limit|billing\s*&?\s*plans/i;
// GitHub emits this when a job could not be scheduled on a hosted runner at
// all — runner pool starvation (capacity constraints, Actions outages).
const RUNNER_UNAVAILABLE_PATTERN = /was not acquired by Runner of type hosted/i;
// A job/run still in `queued` state this long after GitHub accepted it means
// no runner is coming — flag it as infrastructure, not code.
const STUCK_QUEUED_THRESHOLD_MIN = 30;
const STUCK_QUEUED_THRESHOLD_MS = STUCK_QUEUED_THRESHOLD_MIN * 60 * 1000;

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    runs: DEFAULT_RUNS,
    workflow: null,
    repo: process.env.GITHUB_REPOSITORY,
    strict: false,
    json: false,
    quiet: false,
    status: false,
    rerunStuck: false,
    yes: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--runs' || arg === '-n') {
      flags.runs = Number.parseInt(args[i + 1], 10) || DEFAULT_RUNS;
      i += 1;
    } else if (arg === '--workflow' || arg === '-w') {
      flags.workflow = args[i + 1];
      i += 1;
    } else if (arg === '--strict') {
      flags.strict = true;
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--quiet') {
      flags.quiet = true;
    } else if (arg === '--status') {
      flags.status = true;
    } else if (arg === '--rerun-stuck') {
      flags.rerunStuck = true;
    } else if (arg === '--yes') {
      flags.yes = true;
    } else if (arg === '--repo') {
      flags.repo = args[i + 1];
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

async function githubJson(path, token) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: token ? `Bearer ${token}` : undefined,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub API ${url} failed: ${res.status} ${res.statusText}\n${body.slice(0, 300)}`,
    );
  }
  return res.json();
}

/**
 * Classify a single failed job. Pure function — unit-tested offline.
 * @param {{conclusion?: string, status?: string, started_at?: string, steps?: unknown[], name?: string}} job
 * @param {{message?: string}[]} annotations
 * @param {number} [nowMs] - epoch ms for stuck-queued detection (default Date.now())
 * @returns {'billing-block'|'runner-unavailable'|'stuck-queued'|'never-started'|'real-failure'|null}
 */
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
 * True when a job (or run — shape-compatible) was accepted by GitHub's queue
 * (`started_at` set) but is still `queued` long past the threshold.
 * @param {{status?: string, started_at?: string}} job
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

/**
 * Classify a run. Pure function — unit-tested offline.
 * @returns {{infraBlocks: {jobName: string, kind: string, message: string|null}[],
 *            realFailures: string[],
 *            billingBlocked: boolean,
 *            stuckQueued: boolean}}
 */
function classifyRun(jobs, annotationsByJob, run = {}) {
  const result = {
    infraBlocks: [],
    realFailures: [],
    billingBlocked: false,
    stuckQueued: false,
  };
  for (const job of jobs) {
    const annotations = annotationsByJob.get(job.id) || [];
    const kind = classifyJobFailure(job, annotations);
    if (kind === 'billing-block') {
      result.billingBlocked = true;
      result.infraBlocks.push({ jobName: job.name, kind, message: billingMessage(annotations) });
    } else if (kind === 'runner-unavailable') {
      result.infraBlocks.push({
        jobName: job.name,
        kind,
        message: runnerUnavailableMessage(annotations),
      });
    } else if (kind === 'stuck-queued') {
      result.stuckQueued = true;
      result.infraBlocks.push({ jobName: job.name, kind, message: null });
    } else if (kind === 'never-started') {
      result.infraBlocks.push({ jobName: job.name, kind, message: null });
    } else if (kind === 'real-failure') {
      result.realFailures.push(job.name);
    }
  }
  // A run that never started any job and has been sitting in the queue past
  // the threshold is stuck at the run level (GitHub not scheduling anything).
  if (result.infraBlocks.length === 0 && isStuckQueued(run)) {
    result.stuckQueued = true;
    result.infraBlocks.push({ jobName: '(run)', kind: 'stuck-queued', message: null });
  }
  return result;
}

function billingMessage(annotations) {
  const hit = annotations.find((a) => BILLING_BLOCK_PATTERN.test(a.message || ''));
  return hit ? hit.message : 'GitHub billing / spending-limit block';
}

function runnerUnavailableMessage(annotations) {
  const hit = annotations.find((a) => RUNNER_UNAVAILABLE_PATTERN.test(a.message || ''));
  return hit ? hit.message : 'Runner not acquired (GitHub capacity)';
}

function formatRow(run, classification) {
  let marker = 'OK-CODE';
  if (classification.telemetryError) marker = 'UNKNOWN-TELEMETRY';
  else if (classification.billingBlocked) marker = 'BILLING';
  else if (classification.infraBlocks.some((b) => b.kind === 'stuck-queued')) marker = 'STUCK';
  else if (classification.infraBlocks.length > 0) marker = 'INFRA';
  else if (run.conclusion === 'cancelled') marker = 'CANCELLED';
  const real = classification.realFailures.join(', ');
  const line = [String(run.id), run.name || 'Unknown', String(run.created_at || ''), marker];
  const detail =
    classification.infraBlocks.length > 0
      ? classification.infraBlocks.map((b) => `${b.jobName}: ${b.kind}`).join('; ')
      : real || '-';
  return { line, detail, classification };
}

/**
 * Fetch the GitHub Actions incident status from the public status page.
 * @returns {Promise<{name: string, status: string, description: string} | null>}
 */
async function githubActionsStatus() {
  try {
    const res = await fetch('https://www.githubstatus.com/api/v2/components.json');
    if (!res.ok) return null;
    const data = await res.json();
    const actions = (data.components || []).find((c) => c.name === 'Actions');
    if (!actions) return null;
    return {
      name: actions.name,
      status: actions.status,
      description: actions.description || '',
    };
  } catch {
    return null;
  }
}

async function runStatus(quiet) {
  const status = await githubActionsStatus();
  if (!status) {
    if (!quiet) console.log('Could not determine GitHub Actions status (status page unreachable).');
    return 0;
  }
  const healthy = status.status === 'operational';
  if (!quiet) {
    console.log(
      `GitHub Actions: ${status.status}${healthy ? '' : ' — jobs may queue/fail (infra, not code)'}`,
    );
    if (!healthy) {
      console.log(`Watch: https://www.githubstatus.com  (Actions component: ${status.status})`);
    }
  }
  return healthy ? 0 : 1;
}

/**
 * Rerun runs that are stuck in the queue past the threshold (runner
 * starvation). Never touches runs that are progressing or concluded.
 * @returns {Promise<number>} exit code
 */
async function runRerunStuck(flags, owner, name, token) {
  const data = await githubJson(
    `/repos/${owner}/${name}/actions/runs?status=queued&per_page=100`,
    token,
  );
  const now = Date.now();
  const stuck = (data.workflow_runs || []).filter(
    (r) =>
      r.status === 'queued' &&
      (!r.conclusion || r.conclusion === '') &&
      r.created_at &&
      now - Date.parse(r.created_at) > STUCK_QUEUED_THRESHOLD_MS,
  );
  if (stuck.length === 0) {
    console.log(`No runs stuck in queue > ${STUCK_QUEUED_THRESHOLD_MIN} min. Nothing to rerun.`);
    return 0;
  }
  console.log(
    `Found ${stuck.length} run(s) stuck in queue > ${STUCK_QUEUED_THRESHOLD_MIN} min (runner starvation):`,
  );
  for (const r of stuck) {
    console.log(`  ${r.id}  ${r.name || ''}  queued since ${r.created_at}`);
  }
  if (flags.yes) {
    // explicit confirmation given
  } else if (process.stdin.isTTY) {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question('Rerun all of them? [y/N] ', resolve);
    });
    rl.close();
    if (!/^y/i.test(answer.trim())) {
      console.log('Aborted.');
      return 0;
    }
  } else {
    console.log(
      'Refusing to rerun without confirmation: re-run with `--yes` (or confirm in a TTY).',
    );
    return 0;
  }
  let failed = 0;
  for (const r of stuck) {
    const result = spawnSync('gh', ['run', 'rerun', String(r.id)], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.status === 0) {
      console.log(`  reran ${r.id}`);
    } else {
      console.error(`  FAILED to rerun ${r.id}: ${(result.stderr || '').trim()}`);
      failed += 1;
    }
  }
  if (failed > 0) {
    console.error(
      'Rerun failures are usually the same outage that starved the runs — retry once the incident clears:',
    );
    console.error('  node scripts/ci-health.mjs --rerun-stuck --yes');
    return 1;
  }
  return 0;
}

async function main() {
  const flags = parseArgs();
  // The public status endpoint does not require repository authentication.
  if (flags.status) return runStatus(flags.quiet);

  if (!flags.repo) flags.repo = getRepo();
  if (!flags.repo) {
    throw new Error('Could not determine repository. Use --repo or set GITHUB_REPOSITORY.');
  }
  const token = getAuthToken();
  if (!token) {
    throw new Error('No GitHub token available. Set GITHUB_TOKEN or run gh auth login.');
  }

  const [owner, name] = flags.repo.split('/');

  if (flags.rerunStuck) return runRerunStuck(flags, owner, name, token);

  let path = `/repos/${owner}/${name}/actions/runs?per_page=${flags.runs}`;
  if (flags.workflow) path += `&workflow=${encodeURIComponent(flags.workflow)}`;
  const data = await githubJson(path, token);
  const runs = data.workflow_runs || [];

  if (runs.length === 0) {
    console.log('No workflow runs found.');
    return 0;
  }

  const rows = [];
  let infraBlocksTotal = 0;
  let stuckQueuedRuns = 0;
  let telemetryErrors = 0;
  for (const run of runs) {
    // Runs GitHub accepted but has not scheduled past the threshold.
    if (run.status === 'queued' && isStuckQueued(run)) {
      rows.push({
        line: [String(run.id), run.name || 'Unknown', String(run.created_at || ''), 'STUCK'],
        detail: `run queued > ${STUCK_QUEUED_THRESHOLD_MIN} min (runner starvation)`,
        classification: null,
      });
      infraBlocksTotal += 1;
      stuckQueuedRuns += 1;
      continue;
    }
    if (run.conclusion === 'success' || run.conclusion === 'neutral') {
      rows.push({
        line: [String(run.id), run.name || 'Unknown', String(run.created_at || ''), 'OK'],
        detail: '-',
        classification: null,
      });
      continue;
    }
    let jobs = [];
    let jobFetchError = null;
    try {
      const jobsData = await githubJson(
        `/repos/${owner}/${name}/actions/runs/${run.id}/jobs`,
        token,
      );
      jobs = jobsData.jobs || [];
    } catch (error) {
      jobFetchError = error;
      telemetryErrors += 1;
    }
    const annotationsByJob = new Map();
    let annotationFetchError = false;
    for (const job of jobs) {
      if (!job.check_run_url) continue;
      try {
        const ann = await githubJson(`${job.check_run_url}/annotations`, token);
        if (Array.isArray(ann)) annotationsByJob.set(job.id, ann);
      } catch {
        annotationFetchError = true;
        telemetryErrors += 1;
      }
    }
    const classification = classifyRun(jobs, annotationsByJob, run);
    classification.telemetryError = Boolean(jobFetchError || annotationFetchError);
    classification.telemetryMessage =
      jobFetchError?.message ||
      (annotationFetchError ? 'One or more check-run annotation requests failed.' : null);
    infraBlocksTotal += classification.infraBlocks.length;
    if (classification.stuckQueued) stuckQueuedRuns += 1;
    rows.push(formatRow(run, classification));
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          repo: flags.repo,
          runs: rows.map((r) => ({
            id: r.line[0],
            workflow: r.line[1],
            created: r.line[2],
            state: r.line[3],
            detail: r.detail,
          })),
          infraBlocksTotal,
          stuckQueuedRuns,
          telemetryErrors,
        },
        null,
        2,
      ),
    );
  } else if (flags.quiet) {
    if (infraBlocksTotal > 0) {
      console.log(
        `CI HEALTH: ${infraBlocksTotal} job(s)/run(s) blocked (billing, runner outage, or stuck queue). Remote CI is not running code.`,
      );
      if (stuckQueuedRuns > 0) {
        console.log(
          `Fix: check https://www.githubstatus.com for an Actions incident; rerun stuck runs with \`node scripts/ci-health.mjs --rerun-stuck --yes\` once it clears.`,
        );
      } else {
        console.log(
          'Fix: https://github.com/settings/billing — validate locally with `just gate` + `just act-dry` until the block lifts.',
        );
      }
    } else if (telemetryErrors > 0) {
      console.log(
        `CI HEALTH: telemetry incomplete (${telemetryErrors} GitHub API request(s) failed). ` +
          'Treat remote status as unknown until metadata can be fetched.',
      );
    } else {
      console.log('CI HEALTH: no infrastructure blocks in recent runs.');
    }
  } else {
    console.log(`Pipeline health for ${flags.repo} (last ${runs.length} runs):`);
    console.log('');
    for (const r of rows) {
      console.log(
        `  ${r.line[0]}  ${r.line[1].padEnd(24)}  ${r.line[2]}  ${r.line[3].padEnd(9)} ${r.detail}`,
      );
    }
    console.log('');
    if (infraBlocksTotal > 0) {
      console.log(`Infrastructure blocks: ${infraBlocksTotal} job(s)/run(s) blocked.`);
      console.log('These are NOT code failures:');
      if (stuckQueuedRuns > 0) {
        console.log('  - stuck-queued: GitHub is not scheduling jobs (Actions outage / capacity).');
        console.log('    Check https://www.githubstatus.com and rerun with:');
        console.log('      node scripts/ci-health.mjs --rerun-stuck --yes');
      }
      console.log('  - billing: resolve at https://github.com/settings/billing');
      console.log('Validate locally meanwhile: `just gate` and `just act-dry`.');
    } else if (telemetryErrors > 0) {
      console.log(
        `Telemetry errors: ${telemetryErrors} GitHub API request(s) failed; UNKNOWN-TELEMETRY is not healthy.`,
      );
    } else {
      console.log('No infrastructure blocks detected in recent runs.');
    }
  }

  if (flags.strict && (infraBlocksTotal > 0 || telemetryErrors > 0)) return 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(`ci-health failed: ${err.message}`);
      process.exit(2);
    });
}

export { billingMessage, classifyJobFailure, classifyRun, isStuckQueued };

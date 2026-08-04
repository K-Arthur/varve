#!/usr/bin/env node
/**
 * Pipeline health checker: classifies recent workflow-run failures so a
 * broken pipeline is diagnosed without manually sifting logs.
 *
 * Failure taxonomy (shared with ci-debug.mjs):
 *   - billing-block   — GitHub blocked the job before it started (payments
 *                       failed / spending limit exceeded). Not a code failure.
 *   - never-started   — job concluded without any recorded step (runner
 *                       outage / infra issue). Not a code failure.
 *   - real-failure    — at least one step ran and failed. Needs log analysis.
 *
 * Usage:
 *   node scripts/ci-health.mjs                 # last 10 runs across workflows
 *   node scripts/ci-health.mjs --runs 25
 *   node scripts/ci-health.mjs --workflow CI
 *   node scripts/ci-health.mjs --strict        # exit 1 when infra blocks found
 *   node scripts/ci-health.mjs --json          # machine-readable output
 *   node scripts/ci-health.mjs --quiet         # minimal output (pre-push hook)
 *
 * Exit codes:
 *   0 — healthy or only real failures reported
 *   1 — infrastructure block detected (billing / never-started) with --strict
 *   2 — usage / auth error
 */
import { spawnSync } from 'node:child_process';

const API_BASE = 'https://api.github.com';
const DEFAULT_RUNS = 10;
const BILLING_BLOCK_PATTERN =
  /recent account payments have failed|spending limit needs to be increased|spending limit|billing\s*&?\s*plans/i;

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    runs: DEFAULT_RUNS,
    workflow: null,
    repo: process.env.GITHUB_REPOSITORY,
    strict: false,
    json: false,
    quiet: false,
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
 * @param {{conclusion?: string, steps?: unknown[], name?: string}} job
 * @param {{message?: string}[]} annotations
 * @returns {'billing-block'|'never-started'|'real-failure'|null}
 */
function classifyJobFailure(job, annotations) {
  if (job.conclusion !== 'failure' && job.conclusion !== 'timed_out') return null;
  if ((job.steps || []).length > 0) return 'real-failure';
  if (annotations.some((a) => BILLING_BLOCK_PATTERN.test(a.message || ''))) {
    return 'billing-block';
  }
  return 'never-started';
}

/**
 * Classify a run. Pure function — unit-tested offline.
 * @returns {{infraBlocks: {jobName: string, kind: string, message: string|null}[],
 *            realFailures: string[],
 *            billingBlocked: boolean}}
 */
function classifyRun(jobs, annotationsByJob) {
  const result = { infraBlocks: [], realFailures: [], billingBlocked: false };
  for (const job of jobs) {
    const annotations = annotationsByJob.get(job.id) || [];
    const kind = classifyJobFailure(job, annotations);
    if (kind === 'billing-block') {
      result.billingBlocked = true;
      result.infraBlocks.push({ jobName: job.name, kind, message: billingMessage(annotations) });
    } else if (kind === 'never-started') {
      result.infraBlocks.push({ jobName: job.name, kind, message: null });
    } else if (kind === 'real-failure') {
      result.realFailures.push(job.name);
    }
  }
  return result;
}

function billingMessage(annotations) {
  const hit = annotations.find((a) => BILLING_BLOCK_PATTERN.test(a.message || ''));
  return hit ? hit.message : 'GitHub billing / spending-limit block';
}

function formatRow(run, classification) {
  const marker = classification.billingBlocked ? 'BILLING' : 'INFRA';
  const label = classification.infraBlocks.length > 0 ? marker : 'OK-CODE';
  const real = classification.realFailures.join(', ');
  const line = [String(run.id), run.name || 'Unknown', String(run.created_at || ''), label];
  const detail =
    classification.infraBlocks.length > 0
      ? classification.infraBlocks.map((b) => `${b.jobName}: ${b.kind}`).join('; ')
      : real || '-';
  return { line, detail, classification };
}

async function main() {
  const flags = parseArgs();
  if (!flags.repo) flags.repo = getRepo();
  if (!flags.repo) {
    throw new Error('Could not determine repository. Use --repo or set GITHUB_REPOSITORY.');
  }
  const token = getAuthToken();
  if (!token) {
    throw new Error('No GitHub token available. Set GITHUB_TOKEN or run gh auth login.');
  }

  const [owner, name] = flags.repo.split('/');
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
  for (const run of runs) {
    if (
      run.conclusion === 'success' ||
      run.conclusion === 'neutral' ||
      run.conclusion === 'cancelled'
    ) {
      rows.push({
        line: [String(run.id), run.name || 'Unknown', String(run.created_at || ''), 'OK'],
        detail: '-',
        classification: null,
      });
      continue;
    }
    let jobs = [];
    try {
      const jobsData = await githubJson(
        `/repos/${owner}/${name}/actions/runs/${run.id}/jobs`,
        token,
      );
      jobs = jobsData.jobs || [];
    } catch {
      // Run metadata may be unavailable for deleted runs; skip job detail.
    }
    const annotationsByJob = new Map();
    for (const job of jobs) {
      if (!job.check_run_url) continue;
      try {
        const ann = await githubJson(`${job.check_run_url}/annotations`, token);
        if (Array.isArray(ann)) annotationsByJob.set(job.id, ann);
      } catch {
        // annotation fetch is best-effort
      }
    }
    const classification = classifyRun(jobs, annotationsByJob);
    infraBlocksTotal += classification.infraBlocks.length;
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
        },
        null,
        2,
      ),
    );
  } else if (flags.quiet) {
    if (infraBlocksTotal > 0) {
      console.log(
        `CI HEALTH: ${infraBlocksTotal} job(s) never started (billing block or runner outage). Remote CI is not running code.`,
      );
      console.log(
        'Fix: https://github.com/settings/billing — validate locally with `just gate` + `just act-dry` until the block lifts.',
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
      console.log(`Infrastructure blocks: ${infraBlocksTotal} job(s) never started.`);
      console.log(
        'These are NOT code failures. If billing-related, resolve at https://github.com/settings/billing',
      );
      console.log('and re-run. Validate locally meanwhile: `just gate` and `just act-dry`.');
    } else {
      console.log('No infrastructure blocks detected in recent runs.');
    }
  }

  if (flags.strict && infraBlocksTotal > 0) return 1;
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(`ci-health failed: ${err.message}`);
      process.exit(2);
    });
}

export { billingMessage, classifyJobFailure, classifyRun };

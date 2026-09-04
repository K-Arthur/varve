#!/usr/bin/env node

/**
 * Bounded local push checkpoint.
 *
 * Exit contract:
 *   0  local checkpoint passed; remote lanes may be pending
 *   1  a selected local/history validation failed
 *   2  invocation or comparison-base error
 *   4  protected-ref or release-provenance refusal
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPackages } from './affected-plan.mjs';
import {
  buildPushPlan,
  createGitAdapter,
  formatPushPlan,
  parsePrePushInput,
  planExitCode,
} from './push-plan.mjs';
import { laneArgv, packageDirs } from './validation-lanes.mjs';
import { PUSH_LANE_TIMEOUT_MS } from './validation-policy.mjs';
import {
  commonGitDirectory,
  readReceipt,
  receiptIdentity,
  recordOverride,
  writeReceipt,
} from './validation-receipts.mjs';

const ROOT = process.cwd();

for (const [name, packageInfo] of Object.entries(loadPackages()))
  packageDirs[name] = packageInfo.dir;

function parseArgs(args) {
  const result = {
    prePush: args.includes('--pre-push'),
    strict: args.includes('--strict'),
    json: args.includes('--json'),
    dryRun: args.includes('--dry-run') || process.env.VARVE_PUSH_DRY_RUN === '1',
    since: null,
    remote: null,
    remoteUrl: null,
    candidateEvidencePath: null,
  };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--since') result.since = args[++i];
    else if (args[i] === '--remote') result.remote = args[++i];
    else if (args[i] === '--remote-url') result.remoteUrl = args[++i];
    else if (args[i] === '--candidate-evidence') result.candidateEvidencePath = args[++i];
    else if (!args[i].startsWith('--')) positional.push(args[i]);
  }
  // Git appends <remote-name> <remote-url> to the hook invocation.  The thin
  // shell adapter forwards those positional arguments after --pre-push.
  if (!result.remote && positional.length > 0) result.remote = positional[0];
  if (!result.remoteUrl && positional.length > 1) result.remoteUrl = positional[1];
  return result;
}

function commandArgs() {
  const envPath = [
    join(ROOT, 'node_modules', '.bin'),
    process.env.PNPM_HOME ? join(process.env.PNPM_HOME, 'bin') : null,
    join(process.env.HOME ?? '', '.local', 'share', 'pnpm', 'bin'),
    process.env.PATH ?? '',
  ]
    .filter(Boolean)
    .join(delimiter);
  return {
    cwd: ROOT,
    shell: false,
    env: { ...process.env, PATH: envPath },
    stdio: 'inherit',
  };
}

function execute(argv, { dryRun = false, timeoutMs = PUSH_LANE_TIMEOUT_MS.default } = {}) {
  console.log(`    $ ${argv.map((part) => JSON.stringify(part)).join(' ')}`);
  if (dryRun) return 0;
  const result = spawnSync(argv[0], argv.slice(1), {
    ...commandArgs(),
    timeout: timeoutMs,
  });
  if (result.error) {
    const reason = result.signal
      ? `signal ${result.signal}`
      : result.error.code === 'ETIMEDOUT'
        ? `timeout after ${timeoutMs / 1000}s`
        : result.error.message;
    console.error(
      `    spawn failed (${reason}); resources: ${availableParallelism()} CPUs, ` +
        `${Math.round(freemem() / 1024 / 1024)} MiB free / ${Math.round(totalmem() / 1024 / 1024)} MiB total`,
    );
    return 1;
  }
  if (result.signal) {
    console.error(
      `    command terminated by ${result.signal}; resources: ${availableParallelism()} CPUs, ` +
        `${Math.round(freemem() / 1024 / 1024)} MiB free / ${Math.round(totalmem() / 1024 / 1024)} MiB total`,
    );
    return 1;
  }
  return result.status ?? 1;
}

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function existingBiomeFiles(paths) {
  // Do not pass deleted paths to Biome; the deletion is still present in the
  // Git diff and is covered by the history/net-diff policy.
  return paths.filter(
    (path) =>
      /\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(path) &&
      existsSync(join(ROOT, path)) &&
      !path.startsWith('.worktrees/'),
  );
}

function runLane(lane, plan, options = {}) {
  const executeCommand = options.executeCommand ?? execute;
  const files = plan.union.paths;
  if (lane === 'history:secrets' || lane === 'history:policy') {
    console.log(`    [PASS] ${lane} (included in exact outgoing-history scan)`);
    return { status: 0, durationMs: 0, command: ['internal', lane] };
  }
  if (lane === 'format:changed' || lane === 'lint:changed') {
    const command = lane === 'format:changed' ? 'format' : 'check';
    const biomeFiles = existingBiomeFiles(files);
    if (biomeFiles.length === 0) {
      console.log(`    [PASS] ${lane} (no processable net-changed files)`);
      return { status: 0, durationMs: 0, command: ['biome', command] };
    }
    let status = 0;
    const started = Date.now();
    for (const group of chunk(biomeFiles, 80)) {
      const args = ['biome', command, ...group, '--no-errors-on-unmatched'];
      status = executeCommand(args, {
        ...options,
        timeoutMs: PUSH_LANE_TIMEOUT_MS[lane] ?? PUSH_LANE_TIMEOUT_MS.default,
      });
      if (status !== 0) break;
    }
    return { status, durationMs: Date.now() - started, command: ['biome', command] };
  }

  const argv = laneArgv(lane, { files });
  if (!argv) {
    console.error(`    [FAIL] no executable command registered for ${lane}`);
    return { status: 1, durationMs: 0, command: [] };
  }
  const started = Date.now();
  const status = executeCommand(argv, {
    ...options,
    timeoutMs: PUSH_LANE_TIMEOUT_MS[lane] ?? PUSH_LANE_TIMEOUT_MS.default,
  });
  return { status, durationMs: Date.now() - started, command: argv };
}

function writePlanArtifact(plan, commonDir) {
  try {
    const dir = join(commonDir, 'varve-validation', 'plans');
    mkdirSync(dir, { recursive: true });
    const identity = receiptIdentity(plan).identityHash;
    const path = join(dir, `${identity}.json`);
    writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return path;
  } catch (error) {
    console.warn(`Could not write local push plan artifact: ${error.message}`);
    return null;
  }
}

function syntheticSinceUpdate(git, since) {
  const base = git.run(['rev-parse', '--verify', `${since}^{commit}`]);
  const head = git.run(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (base.status !== 0 || head.status !== 0) {
    const error = new Error(`cannot resolve --since ${since} or HEAD`);
    error.code = 2;
    throw error;
  }
  return [
    {
      localRef: 'HEAD',
      localSha: head.stdout.trim(),
      remoteRef:
        since.startsWith('refs/') || since === 'HEAD' || since.startsWith('HEAD')
          ? since
          : `refs/remotes/${since}`,
      remoteSha: base.stdout.trim(),
    },
  ];
}

export function runPushCheckpoint({
  input = '',
  args = process.argv.slice(2),
  git = createGitAdapter(ROOT),
  now = Date.now(),
  planBuilder,
  executeCommand,
} = {}) {
  const flags = parseArgs(args);
  let updates;
  try {
    updates = flags.since ? syntheticSinceUpdate(git, flags.since) : parsePrePushInput(input);
  } catch (error) {
    return { status: error.code ?? 2, message: error.message, plan: null, outcomes: [] };
  }
  let commonDir;
  try {
    commonDir = commonGitDirectory({ git, cwd: ROOT });
  } catch {
    commonDir = join(ROOT, '.git');
  }
  let plan;
  try {
    plan = buildPushPlan(updates, {
      git,
      cwd: ROOT,
      root: ROOT,
      remote: flags.remote ?? 'origin',
      remoteUrl: flags.remoteUrl,
      strict: flags.strict,
      candidateEvidencePath: flags.candidateEvidencePath,
      commonGitDir: commonDir,
      planBuilder,
    });
  } catch (error) {
    return { status: error.code ?? 2, message: error.message, plan: null, outcomes: [] };
  }

  const artifactPath = writePlanArtifact(plan, commonDir);
  if (flags.json) console.log(formatPushPlan(plan, { json: true }));
  else console.log(formatPushPlan(plan));

  const immediateCode = planExitCode(plan);
  if (immediateCode !== 0) {
    return { status: immediateCode, plan, outcomes: [], artifactPath };
  }

  const overrideReason = String(process.env.VARVE_PUSH_OVERRIDE_REASON ?? '').trim();
  const reusable = !overrideReason
    ? readReceipt(plan, { commonDir, git, cwd: ROOT, now })
    : { reusable: false, reason: 'override-active' };
  if (reusable.reusable) {
    console.log(`Exact push checkpoint receipt reused (${reusable.path}).`);
    console.log(
      'Remote certification remains authoritative; a local receipt never satisfies CI or release candidate checks.',
    );
    return { status: 0, plan, outcomes: [], reused: true, artifactPath };
  }

  const lanes = overrideReason
    ? plan.localBlockingLanes.filter((lane) =>
        ['history:secrets', 'history:policy', 'format:changed', 'lint:changed'].includes(lane),
      )
    : plan.localBlockingLanes;
  if (overrideReason) {
    console.warn(`Emergency push override requested: ${overrideReason}`);
    console.warn(
      'Only history/security and changed-file checks run; this is recorded locally and cannot bypass protected refs or release provenance.',
    );
  }
  const outcomes = [];
  let failed = null;
  for (const lane of lanes) {
    const outcome = runLane(lane, plan, {
      dryRun: flags.dryRun,
      executeCommand,
    });
    outcomes.push({ lane, ...outcome });
    if (outcome.status !== 0) {
      failed = { lane, ...outcome };
      break;
    }
  }
  if (failed && !overrideReason) {
    console.error(`Push blocked: ${failed.lane} failed.`);
    console.error(
      `Reproduce with the command printed above. Diagnostics: ${artifactPath ?? 'local plan artifact unavailable'}`,
    );
    return { status: 1, plan, outcomes, artifactPath };
  }
  if (overrideReason) {
    let entry = null;
    if (flags.dryRun) {
      console.warn(
        'Dry run: the emergency override was not recorded. A real override must leave a local audit entry.',
      );
    } else {
      try {
        entry = recordOverride(overrideReason, plan, { commonDir, git, cwd: ROOT, now });
      } catch (error) {
        console.error(`Push blocked: could not record the override locally: ${error.message}`);
        return { status: 1, plan, outcomes, artifactPath };
      }
    }
    plan.override = { reason: overrideReason, recorded: Boolean(entry), entry };
    if (entry)
      console.warn(
        `Override recorded in ${join(commonDir, 'varve-validation', 'overrides.ndjson')}.`,
      );
  } else if (!flags.dryRun) {
    try {
      writeReceipt(plan, {
        commonDir,
        git,
        cwd: ROOT,
        now,
        commands: outcomes.map((outcome) => outcome.command),
        outcomes: outcomes.map(({ lane, status }) => ({ lane, status })),
        durations: Object.fromEntries(outcomes.map(({ lane, durationMs }) => [lane, durationMs])),
      });
    } catch (error) {
      console.warn(`Push passed but receipt cache was unavailable: ${error.message}`);
    }
  } else {
    console.log('Dry run: no validation receipt was written.');
  }
  console.log(
    'Push checkpoint passed. Remote certification is required where the plan says so; deferred lanes are not local failures.',
  );
  if (plan.deferredLanes.length) console.log(`Deferred to CI: ${plan.deferredLanes.join(', ')}`);
  return { status: 0, plan, outcomes, artifactPath };
}

async function main() {
  const input = await new Promise((resolve) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunkValue) => (value += chunkValue));
    process.stdin.on('end', () => resolve(value));
    if (process.stdin.isTTY) resolve('');
  });
  const result = runPushCheckpoint({ input });
  if (result.status !== 0 && result.message)
    console.error(`Push checkpoint could not start: ${result.message}`);
  process.exitCode = result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { chunk, parseArgs, runLane };

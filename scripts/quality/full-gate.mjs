/** Resumable local full-gate lanes; receipts are never remote certification. */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonGitDirectory, finishOperation, startOperation } from './operation-history.mjs';
import {
  computePolicyHash,
  POLICY_VERSION,
  PUSH_LIMITS,
  sha256,
  toolVersions,
} from './validation-policy.mjs';

const SCHEMA = 1;

function gitText(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

export function frozenSource(root) {
  const clean = gitText(root, ['status', '--porcelain=v1', '-z']) === '';
  return {
    clean,
    commitSha: gitText(root, ['rev-parse', '--verify', 'HEAD^{commit}']),
    treeSha: gitText(root, ['rev-parse', '--verify', 'HEAD^{tree}']),
  };
}

function filesUnder(root, relativePath) {
  const entries = readdirSync(join(root, relativePath), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${relativePath}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(root, path) : [path];
  });
}

function runtimeInputPaths(root) {
  const paths = ['node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml'];
  for (const dir of ['apps/desktop/public/wasm', 'apps/desktop/public/models']) {
    try {
      paths.push(...filesUnder(root, dir));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      paths.push(dir);
    }
  }
  return [...new Set(paths)].sort();
}

// A lane loop rechecks metadata before reusing an already-computed digest.
// Large optional models are hashed once per invocation when their bytes stay
// unchanged, rather than reading hundreds of MB again before every lane.
function inputHasher(root) {
  const memo = new Map();
  return () =>
    sha256(
      runtimeInputPaths(root)
        .map((path) => {
          const absolute = join(root, path);
          let stat;
          try {
            stat = statSync(absolute, { bigint: true });
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            return `${path}\0<missing>`;
          }
          const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
          let cached = memo.get(path);
          if (cached?.stamp !== stamp) {
            cached = { stamp, digest: sha256(readFileSync(absolute)) };
            memo.set(path, cached);
          }
          return `${path}\0${cached.digest}`;
        })
        .join('\0'),
    );
}

function identityFor(lane, source, { policyHash, tools, environmentHash, runtimeHash }) {
  return {
    schema: SCHEMA,
    profile: 'local-full-gate',
    commitSha: source.commitSha,
    treeSha: source.treeSha,
    lane: lane.label,
    argv: lane.argv,
    policyVersion: POLICY_VERSION,
    policyHash,
    tools,
    environmentHash,
    runtimeHash,
  };
}

function receiptPath(dir, identity) {
  return join(dir, `${sha256(JSON.stringify(identity))}.json`);
}

export function readFullGateReceipt(path, identity, now = Date.now()) {
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    const age = now - Date.parse(record.recordedAt);
    return (
      record.schema === SCHEMA &&
      record.outcome === 'passed' &&
      age >= 0 &&
      age <= PUSH_LIMITS.receiptMaxAgeMs &&
      JSON.stringify(record.identity) === JSON.stringify(identity)
    );
  } catch {
    return false;
  }
}

function writeReceipt(path, identity, outcome, now, durationMs = null, termination = {}) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(
    temp,
    `${JSON.stringify(
      {
        schema: SCHEMA,
        identity,
        outcome,
        durationMs,
        ...termination,
        recordedAt: new Date(now).toISOString(),
        note: 'Local full-gate receipt only; not integration, candidate, signing or release evidence.',
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  renameSync(temp, path);
}

export async function runFullGate(
  lanes,
  {
    root = process.cwd(),
    execute,
    resume = false,
    now = () => Date.now(),
    tools = toolVersions({ root }),
    environment = process.env,
  } = {},
) {
  if (typeof execute !== 'function') throw new Error('full gate requires an executor');
  const initialSource = frozenSource(root);
  const commonDir = commonGitDirectory({ cwd: root });
  const dir = join(commonDir, 'varve-validation', 'full-gate-receipts');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const environmentHash = sha256(
    JSON.stringify(Object.entries(environment).sort(([a], [b]) => a.localeCompare(b))),
  );
  const policyHash = computePolicyHash({ root });
  const runtimeHash = inputHasher(root);
  const operation = startOperation({
    type: 'full-gate',
    cwd: root,
    commonDir,
    requested: { resume, commitSha: initialSource.commitSha, policyHash },
    now: now(),
  });
  const outcomes = [];
  const finish = (status, message = null) => {
    finishOperation(operation.path, {
      status: status === 0 ? 'completed' : outcomes.at(-1)?.signal ? 'cancelled' : 'failed',
      exitCode: status,
      result: { outcomes, message, commitSha: initialSource.commitSha, policyHash },
      now: now(),
    });
    return { status, outcomes, message, operationPath: operation.path };
  };
  if (!initialSource.clean)
    console.log('Full gate: worktree is dirty; reusable lane receipts are disabled.');
  for (const lane of lanes) {
    const before = frozenSource(root);
    if (initialSource.clean && (!before.clean || before.commitSha !== initialSource.commitSha))
      return finish(
        1,
        'Source changed during full gate; commit a stable candidate before retrying.',
      );
    const identity = identityFor(lane, before, {
      policyHash,
      tools,
      environmentHash,
      runtimeHash: runtimeHash(),
    });
    const path = receiptPath(dir, identity);
    if (initialSource.clean && resume && readFullGateReceipt(path, identity, now())) {
      console.log(`  [REUSE] ${lane.label} (exact clean source and unchanged inputs)`);
      outcomes.push({ lane: lane.label, status: 0, reused: true, durationMs: 0 });
      continue;
    }
    const started = now();
    // Invalidate an older green receipt before a fresh attempt: failure or an
    // interruption of the same inputs must not leave a reusable earlier pass.
    if (initialSource.clean) writeReceipt(path, identity, 'running', started);
    let status;
    let signal = null;
    try {
      const result = await execute(lane.argv);
      status = typeof result === 'number' ? result : result.status;
      signal = typeof result === 'number' ? null : result.signal;
      if (!Number.isInteger(status) || status < 0 || status > 255)
        throw new Error('full-gate executor returned an invalid exit status');
    } catch (error) {
      finish(1, error.message);
      throw error;
    }
    const durationMs = now() - started;
    outcomes.push({ lane: lane.label, status, signal, reused: false, durationMs });
    if (signal) {
      if (initialSource.clean)
        writeReceipt(path, identity, 'cancelled', now(), durationMs, { exitCode: status, signal });
      return finish(status, `Lane ${lane.label} ended with ${signal}.`);
    }
    const after = frozenSource(root);
    if (initialSource.clean && (!after.clean || after.commitSha !== initialSource.commitSha))
      return finish(1, 'Source changed during full gate; no receipt was accepted for this lane.');
    const afterRuntimeHash = runtimeHash();
    if (initialSource.clean && identity.runtimeHash !== afterRuntimeHash && !lane.producesRuntime)
      return finish(
        1,
        'Generated runtime inputs changed during this lane; its pass is incomplete.',
      );
    if (initialSource.clean) {
      const recordedIdentity = lane.producesRuntime
        ? { ...identity, runtimeHash: afterRuntimeHash }
        : identity;
      writeReceipt(
        receiptPath(dir, recordedIdentity),
        recordedIdentity,
        status === 0 ? 'passed' : signal ? 'cancelled' : 'failed',
        now(),
        durationMs,
        { exitCode: status, signal },
      );
    }
    console.log(
      `  [${status === 0 ? 'PASS' : 'FAIL'}] ${lane.label} (${(durationMs / 1000).toFixed(1)}s)`,
    );
    if (status !== 0) return finish(status);
  }
  return finish(0);
}

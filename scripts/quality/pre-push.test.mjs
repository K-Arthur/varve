#!/usr/bin/env node

/** Hook adapter parsing tests; no Git push or validation process is started. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, pushLaneArgv, runLane } from './pre-push.mjs';
import {
  LANE_COST_SECONDS,
  PUSH_LANE_TIMEOUT_MS,
  PUSH_LIMITS,
  selectPushValidation,
} from './validation-policy.mjs';

const since = parseArgs(['--since', 'origin/master', '--dry-run']);
assert.equal(since.since, 'origin/master');
assert.equal(since.remote, null, 'the --since value is not mistaken for a remote name');
assert.equal(since.dryRun, true);

const hook = parseArgs(['--pre-push', 'origin', 'https://example.invalid/varve.git']);
assert.equal(hook.prePush, true);
assert.equal(hook.remote, 'origin');
assert.equal(hook.remoteUrl, 'https://example.invalid/varve.git');

const candidate = parseArgs([
  '--candidate-evidence',
  'candidate evidence.json',
  '--remote',
  'origin',
  '--remote-url',
  'https://example.invalid/varve.git',
]);
assert.equal(candidate.candidateEvidencePath, 'candidate evidence.json');
assert.equal(candidate.remote, 'origin');
assert.equal(candidate.remoteUrl, 'https://example.invalid/varve.git');

assert.equal(
  parseArgs(['--since']).since,
  undefined,
  'missing option values remain invalid input for the driver',
);

// A real local lane failure remains a blocking result. The executor is
// injected here so the regression test never starts a repository-wide suite.
const failedLane = runLane(
  'js-unit:file:tests/unit/failing.test.ts',
  { union: { paths: [] } },
  { executeCommand: () => 1 },
);
assert.equal(failedLane.status, 1, 'local unit failure blocks the push checkpoint');
assert.deepEqual(failedLane.command, [
  'pnpm',
  'exec',
  'vitest',
  'run',
  'tests/unit/failing.test.ts',
]);

const formatCommands = [];
const formatLane = runLane(
  'format:changed',
  { union: { paths: ['scripts/quality/pre-push.test.mjs'] } },
  {
    executeCommand: (args) => {
      formatCommands.push(args);
      return 0;
    },
  },
);
assert.equal(formatLane.status, 0, 'format lane should invoke Biome successfully');
assert.deepEqual(formatCommands, [
  ['biome', 'format', 'scripts/quality/pre-push.test.mjs', '--no-errors-on-unmatched'],
]);

const snapshotEnvironment = { CARGO_TARGET_DIR: '/fixture/common-git/validation/cargo-target' };
const cargoLane = runLane(
  'rust-test:varve-print',
  { union: { paths: [] } },
  {
    cwd: '/fixture/exact-snapshot',
    env: snapshotEnvironment,
    executeCommand: (_args, options) => {
      assert.equal(options.cwd, '/fixture/exact-snapshot');
      assert.deepEqual(options.env, snapshotEnvironment);
      assert.equal(options.timeoutMs, PUSH_LANE_TIMEOUT_MS.default);
      return 0;
    },
  },
);
assert.equal(cargoLane.status, 0);

// Resource ownership is independent of selected scope and exact-tree cwd.
// Execute is injected: these assertions never start Vitest, TSC or Cargo.
for (const lane of [
  'js-unit:@varve/editor',
  'js-unit:file:tests/unit/sample.test.ts',
  'typecheck:@varve/editor',
  'typecheck:e2e',
  'rust-test:varve-print',
  'rust-clippy:varve-print',
]) {
  let observed;
  const outcome = runLane(
    lane,
    { union: { paths: [] } },
    {
      cwd: '/fixture/exact-snapshot',
      env: { CARGO_TARGET_DIR: '/fixture/cargo', VARVE_TEST_WORKERS: '2' },
      executeCommand: (argv, options) => {
        observed = { argv, options };
        return 7;
      },
    },
  );
  assert.equal(outcome.status, 7, `${lane} failures remain blocking`);
  assert.equal(observed.argv[0], process.execPath);
  assert.match(observed.argv[1], /scripts[/\\]quality[/\\]heavy-lease\.mjs$/);
  assert.equal(observed.argv[2], `push: ${lane}`);
  assert.equal(observed.argv[3], '--');
  assert.deepEqual(observed.argv.slice(4), outcome.command);
  assert.equal(observed.options.cwd, '/fixture/exact-snapshot');
  assert.equal(observed.options.env.CARGO_TARGET_DIR, '/fixture/cargo');
  assert.equal(
    observed.options.timeoutMs,
    PUSH_LANE_TIMEOUT_MS[lane] ?? PUSH_LANE_TIMEOUT_MS.default,
  );
  assert.equal(
    observed.options.env.VARVE_TEST_WORKERS,
    lane.startsWith('js-unit:file:') ? '1' : '2',
  );
}
for (const lane of [
  'website-e2e',
  'website-e2e:file:apps/website/tests/e2e/home.spec.ts',
  'audit:docs',
  'workflow-validate',
]) {
  const argv = ['fixture', 'command'];
  assert.equal(pushLaneArgv(lane, argv), argv, `${lane} has no redundant outer lease`);
}

// A C++-backed crate is not cheap merely because only two crates changed.
// Ordinary push explicitly defers its cold profiles, preserving the smaller
// print checks and both crate-specific and canonical remote obligations.
const nativePlan = {
  tiers: {
    0: [],
    1: [],
    2: [
      'rust-test:varve-generative-helper',
      'rust-clippy:varve-generative-helper',
      'rust-test:varve-print',
      'rust-clippy:varve-print',
    ],
    3: [],
    4: [],
  },
  changed: {
    js: [],
    rust: ['crates/varve-generative-helper/src/main.rs', 'crates/varve-print/src/lib.rs'],
    other: [],
    app: [],
  },
  full: false,
  reasons: [],
};
const nativeFiles = nativePlan.changed.rust;
const ordinaryNative = selectPushValidation(nativePlan, { files: nativeFiles });
for (const lane of ['rust-test:varve-generative-helper', 'rust-clippy:varve-generative-helper']) {
  assert.ok(!ordinaryNative.localBlocking.includes(lane), `${lane} is not a cheap local check`);
  assert.ok(ordinaryNative.deferred.includes(lane), `${lane} must be explicitly deferred`);
  assert.ok(ordinaryNative.remoteRequired.includes(lane), `${lane} remains required remotely`);
  assert.match(ordinaryNative.reasons.join('\n'), new RegExp(`${lane}: cold native compile`));
  assert.ok(LANE_COST_SECONDS[lane] > PUSH_LANE_TIMEOUT_MS.default / 1000);
  const singleLane = selectPushValidation(
    { ...nativePlan, tiers: { ...nativePlan.tiers, 2: [lane] } },
    { files: nativeFiles },
  );
  assert.ok(singleLane.deferred.includes(lane), 'one cold native profile must not evade deferral');
}
for (const lane of ['rust-test:varve-print', 'rust-clippy:varve-print']) {
  assert.ok(ordinaryNative.localBlocking.includes(lane), `${lane} still runs locally`);
  assert.ok(!ordinaryNative.deferred.includes(lane));
}
for (const lane of ['rust-test:all', 'rust-clippy:all']) {
  assert.ok(ordinaryNative.remoteRequired.includes(lane), `${lane} must certify the exact SHA`);
  assert.ok(ordinaryNative.promisedIntegrationLanes.includes(lane));
  assert.ok(ordinaryNative.promisedCandidateLanes.includes(lane));
}
assert.equal(PUSH_LANE_TIMEOUT_MS.default, 300_000, 'ordinary local deadlines remain bounded');
assert.equal(PUSH_LIMITS.maxLocalEstimatedSeconds, 720, 'the push planning budget is unchanged');
const strictNative = selectPushValidation(nativePlan, { files: nativeFiles, strict: true });
assert.deepEqual(strictNative.deferred, [], 'explicit strict mode never silently defers checks');
assert.ok(strictNative.localBlocking.includes('rust-test:varve-generative-helper'));
assert.ok(strictNative.localBlocking.includes('rust-clippy:varve-generative-helper'));

assert.ok(
  PUSH_LANE_TIMEOUT_MS['js-unit:@varve/editor'] >= 30 * 60 * 1000,
  'the editor package push check must allow its measured 1528-second suite to finish',
);

// The hook still reports a failed checkpoint with CI diagnostics. Successful
// pushes skip those informational network calls on the critical path.
const hookDir = mkdtempSync(join(tmpdir(), 'varve-hook-check-'));
try {
  const hookPath = fileURLToPath(new URL('../../.githooks/pre-push', import.meta.url));
  const logPath = join(hookDir, 'calls.log');
  const pnpmPath = join(hookDir, 'pnpm');
  const nodePath = join(hookDir, 'node');
  writeFileSync(
    pnpmPath,
    '#!/bin/sh\nprintf "pnpm %s\\n" "$*" >> "$HOOK_LOG"\nexit "$VARVE_TEST_PUSH_STATUS"\n',
  );
  writeFileSync(nodePath, '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$HOOK_LOG"\n');
  chmodSync(pnpmPath, 0o755);
  chmodSync(nodePath, 0o755);
  for (const [checkpointStatus, expectedCalls] of [
    ['0', 1],
    ['1', 3],
  ]) {
    writeFileSync(logPath, '');
    const result = spawnSync('sh', [hookPath, 'origin', 'https://example.invalid/varve.git'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [hookDir, process.env.PATH ?? ''].join(delimiter),
        CI: '',
        HOOK_LOG: logPath,
        VARVE_TEST_PUSH_STATUS: checkpointStatus,
      },
    });
    assert.equal(result.status, Number(checkpointStatus));
    const calls = readFileSync(logPath, 'utf8').trim().split('\n');
    assert.equal(calls.length, expectedCalls);
    assert.match(calls[0], /^pnpm verify:push --pre-push origin /);
    if (checkpointStatus === '1') {
      assert.match(calls[1], /^node scripts\/ci-health\.mjs --quiet$/);
      assert.match(calls[2], /^node scripts\/ci-health\.mjs --status --quiet$/);
    }
  }
} finally {
  rmSync(hookDir, { recursive: true, force: true });
}

console.log('pre-push adapter tests passed');

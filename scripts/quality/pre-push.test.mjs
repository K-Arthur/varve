#!/usr/bin/env node

/** Hook adapter parsing tests; no Git push or validation process is started. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runLane } from './pre-push.mjs';
import { PUSH_LANE_TIMEOUT_MS } from './validation-policy.mjs';

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
        PATH: `${hookDir}:${process.env.PATH ?? ''}`,
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

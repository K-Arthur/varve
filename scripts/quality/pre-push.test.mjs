#!/usr/bin/env node

/** Hook adapter parsing tests; no Git push or validation process is started. */

import assert from 'node:assert/strict';
import { parseArgs, runLane } from './pre-push.mjs';

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

console.log('pre-push adapter tests passed');

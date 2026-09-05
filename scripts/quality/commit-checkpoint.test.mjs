#!/usr/bin/env node

import assert from 'node:assert/strict';
import { runCommitCheckpoint, selectCommitCommands } from './commit-checkpoint.mjs';

const stagedFiles = [
  'packages/ui/src/components/Radio.test.tsx',
  'packages/ui/src/components/Radio.tsx',
  'tests/e2e/canvas/toolbar.spec.ts',
];

function withoutCiEnvironment(callback) {
  const previous = process.env.CI;
  delete process.env.CI;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.CI;
    else process.env.CI = previous;
  }
}

const selection = selectCommitCommands(stagedFiles);
const lanes = selection.commands.map((entry) => entry.lane);
assert.ok(lanes.includes('format-lint:staged'));
assert.ok(lanes.includes('import-boundaries'));
assert.ok(lanes.includes('typecheck:e2e'));
assert.ok(lanes.includes('direct-unit'));
assert.ok(!selection.commands.some((entry) => entry.argv.includes('playwright')));
assert.ok(!selection.commands.some((entry) => entry.argv.includes('cargo')));
for (const entry of selection.commands.filter((item) => item.argv.includes('vitest'))) {
  assert.ok(entry.argv.includes('--maxWorkers=1'));
  assert.ok(entry.argv.some((part) => part.endsWith('.test.tsx')));
}

const executed = [];
const passed = withoutCiEnvironment(() =>
  runCommitCheckpoint({
    stagedFiles,
    executeCommand: (argv) => {
      executed.push(argv);
      return 0;
    },
    dryRun: true,
  }),
);
assert.equal(passed, 0);
assert.ok(executed.some((argv) => argv.some((part) => part.endsWith('Radio.test.tsx'))));

const failed = withoutCiEnvironment(() =>
  runCommitCheckpoint({
    stagedFiles: ['packages/ui/src/components/Radio.tsx'],
    executeCommand: (argv) => (argv.includes('biome') ? 1 : 0),
    dryRun: false,
  }),
);
assert.equal(failed, 1);

console.log('commit-checkpoint.test.mjs: all assertions passed');

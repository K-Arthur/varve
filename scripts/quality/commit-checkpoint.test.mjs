#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

// The actual checkpoint must use the guarded .cmd adapter; inject only the
// native spawn boundary to exercise Windows parsing without a Windows host.
const windowsSource = `
  import assert from 'node:assert/strict';
  import cp from 'node:child_process';
  import { syncBuiltinESMExports } from 'node:module';
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const calls=[];
  cp.spawnSync=(command,args,options)=>{calls.push({command,args,options});return {status:7,signal:null,error:undefined}};
  syncBuiltinESMExports();
  const {execute}=await import(${JSON.stringify(new URL('./commit-checkpoint.mjs', import.meta.url).href)});
  assert.equal(execute(['fixture.cmd','literal & (parentheses)']),7);
  assert.equal(calls.length,1);
  assert.match(calls[0].command,/cmd\\.exe$/i);
  assert.equal(calls[0].options.shell,false);
  assert.equal(calls[0].options.windowsVerbatimArguments,true);
  assert.ok(calls[0].args.at(-1).includes('^&'));
  for(const bad of ['line\\nbreak','line\\rbreak','nul\\0break']) assert.equal(execute(['fixture.cmd',bad]),1);
  assert.equal(calls.length,1,'unsafe batch argv cannot reach native spawn');
`;
const windows = spawnSync(process.execPath, ['--input-type=module', '-e', windowsSource], {
  encoding: 'utf8',
  timeout: 5000,
});
assert.equal(windows.error, undefined, windows.error?.message);
assert.equal(windows.status, 0, windows.stderr);
assert.match(windows.stderr, /Windows batch command arguments cannot contain line breaks or NUL/);

console.log('commit-checkpoint.test.mjs: all assertions passed');

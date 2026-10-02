/** Real Git fixtures prove local full-gate resume and invalidation boundaries. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFullGateReceipt, runFullGate } from './full-gate.mjs';

const root = mkdtempSync(join(tmpdir(), 'varve-full-gate-'));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const lanes = [
  { label: 'unit', argv: ['unit-test'] },
  { label: 'browser', argv: ['browser-test'] },
];
const timestamp = Date.parse('2026-10-02T12:00:00Z');
let currentTime = timestamp;
const options = {
  root,
  tools: { node: 'fixture', playwright: 'fixture' },
  environment: { FIXTURE: 'true', PRIVATE_FIXTURE: 'never-store-this-fixture' },
  now: () => currentTime,
};

try {
  git(['init', '-q']);
  git(['config', 'user.name', 'Varve full-gate fixture']);
  git(['config', 'user.email', 'full-gate@example.invalid']);
  writeFileSync(join(root, '.gitignore'), 'node_modules/\napps/desktop/public/wasm/\n');
  writeFileSync(join(root, 'source.js'), 'export const value = 1;\n');
  git(['add', '.']);
  git(['commit', '-qm', 'candidate']);

  let called = [];
  const first = await runFullGate(lanes, {
    ...options,
    execute: (argv) => {
      called.push(argv[0]);
      return argv[0] === 'browser-test' ? 1 : 0;
    },
  });
  assert.equal(first.status, 1);
  assert.deepEqual(called, ['unit-test', 'browser-test']);

  called = [];
  const resumed = await runFullGate(lanes, {
    ...options,
    resume: true,
    execute: (argv) => {
      called.push(argv[0]);
      return 0;
    },
  });
  assert.equal(resumed.status, 0);
  assert.deepEqual(
    called,
    ['browser-test'],
    'only the failed lane is repeated at unchanged inputs',
  );
  assert.equal(resumed.outcomes[0].reused, true);

  let completeLane;
  const pending = runFullGate(lanes, {
    ...options,
    execute: () =>
      new Promise((resolve) => {
        completeLane = resolve;
      }),
  });
  assert.equal(typeof completeLane, 'function', 'the async lane is actually executing');
  completeLane({ status: 143, signal: 'SIGTERM' });
  const cancelled = await pending;
  assert.equal(cancelled.status, 143, 'signal status must not become generic failure or success');
  assert.equal(cancelled.outcomes[0].signal, 'SIGTERM');
  assert.equal(JSON.parse(readFileSync(cancelled.operationPath, 'utf8')).status, 'cancelled');
  assert.equal(cancelled.outcomes.length, 1, 'no next lane starts after cancellation');
  called = [];
  await runFullGate(lanes, {
    ...options,
    resume: true,
    execute: async (argv) => {
      called.push(argv[0]);
      return 0;
    },
  });
  assert.deepEqual(called, ['unit-test'], 'a cancelled lane cannot reuse a green receipt');

  const receiptDir = join(root, '.git/varve-validation/full-gate-receipts');
  const receiptPath = readdirSync(receiptDir).map((name) => join(receiptDir, name))[0];
  const receiptText = readFileSync(receiptPath, 'utf8');
  assert.ok(
    !receiptText.includes('never-store-this-fixture'),
    'environment values are never stored',
  );
  const receipt = JSON.parse(receiptText);
  assert.equal(readFullGateReceipt(receiptPath, receipt.identity, timestamp), true);
  assert.equal(readFullGateReceipt(receiptPath, receipt.identity, timestamp - 1), false);
  assert.equal(
    readFullGateReceipt(receiptPath, receipt.identity, timestamp + 7 * 60 * 60 * 1000),
    false,
  );

  // A new fresh attempt supersedes old green evidence, even if it fails.
  await runFullGate(lanes, { ...options, execute: () => 1 });
  called = [];
  await runFullGate(lanes, {
    ...options,
    resume: true,
    execute: (argv) => {
      called.push(argv[0]);
      return 0;
    },
  });
  assert.deepEqual(called, ['unit-test']);

  // A process interruption leaves a running lane, which cannot be resumed as
  // green; the earlier green evidence has already been invalidated.
  await assert.rejects(
    () =>
      runFullGate(lanes, {
        ...options,
        execute: () => {
          throw new Error('interrupted');
        },
      }),
    /interrupted/,
  );
  called = [];
  await runFullGate(lanes, {
    ...options,
    resume: true,
    execute: (argv) => {
      called.push(argv[0]);
      return 0;
    },
  });
  assert.deepEqual(called, ['unit-test']);

  const assertBothRun = async (overrides = {}) => {
    called = [];
    const result = await runFullGate(lanes, {
      ...options,
      resume: true,
      ...overrides,
      execute: (argv) => {
        called.push(argv[0]);
        return 0;
      },
    });
    assert.equal(result.status, 0);
    assert.deepEqual(called, ['unit-test', 'browser-test']);
  };
  await assertBothRun({ tools: { node: 'different', playwright: 'fixture' } });
  await assertBothRun({ environment: { ...options.environment, FIXTURE: 'changed' } });

  mkdirSync(join(root, 'node_modules/.pnpm'), { recursive: true });
  writeFileSync(join(root, 'node_modules/.pnpm/lock.yaml'), 'different installed dependency graph');
  await assertBothRun();
  mkdirSync(join(root, 'apps/desktop/public/wasm'), { recursive: true });
  writeFileSync(join(root, 'apps/desktop/public/wasm/varve.wasm'), 'wasm bytes');
  await assertBothRun();
  writeFileSync(join(root, 'apps/desktop/public/wasm/varve.wasm'), 'new wasm bytes');
  await assertBothRun();

  writeFileSync(join(root, 'source.js'), 'export const value = 2;\n');
  await assertBothRun(); // dirty trees never reuse clean-source passes
  git(['add', 'source.js']);
  git(['commit', '-qm', 'new candidate']);
  await assertBothRun(); // a different exact candidate SHA never aliases the old one

  currentTime += 7 * 60 * 60 * 1000;
  await assertBothRun();
  const buildLanes = [
    { label: 'wasm', argv: ['wasm-build'], producesRuntime: true },
    { label: 'browser', argv: ['browser-test'] },
  ];
  const buildOptions = {
    ...options,
    execute: (argv) => {
      if (argv[0] === 'wasm-build')
        writeFileSync(join(root, 'apps/desktop/public/wasm/varve.wasm'), 'fresh build');
      return 0;
    },
  };
  assert.equal((await runFullGate(buildLanes, buildOptions)).status, 0);
  called = [];
  const buildResume = await runFullGate(buildLanes, {
    ...options,
    resume: true,
    execute: (argv) => {
      called.push(argv[0]);
      return 0;
    },
  });
  assert.equal(buildResume.status, 0);
  assert.deepEqual(
    called,
    [],
    'a production WASM build records its resulting bytes for later resume',
  );
  const changedRuntime = await runFullGate(lanes, {
    ...options,
    execute: () => {
      writeFileSync(join(root, 'apps/desktop/public/wasm/varve.wasm'), 'unexpected change');
      return 0;
    },
  });
  assert.equal(changedRuntime.status, 1);
  assert.match(changedRuntime.message, /runtime inputs changed/);
  const changedWhileRunning = await runFullGate(lanes, {
    ...options,
    execute: () => {
      writeFileSync(join(root, 'source.js'), 'changed mid-run');
      return 0;
    },
  });
  assert.equal(changedWhileRunning.status, 1);
  assert.match(changedWhileRunning.message, /Source changed/);
  assert.equal(changedWhileRunning.outcomes.length, 1);
  console.log('full-gate resume tests passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fullGateExecution, localBrowserLanes } from './full-gate-execution.mjs';
import { FULL_BROWSER_SHARDS } from './validation-policy.mjs';

test('release full gates default to remote ownership; offline execution is deliberate', () => {
  assert.deepEqual(fullGateExecution([]), { mode: 'remote', resume: false });
  assert.deepEqual(fullGateExecution(['--remote', '--resume']), { mode: 'remote', resume: true });
  assert.deepEqual(fullGateExecution(['--local', '--resume']), { mode: 'local', resume: true });
  assert.throws(() => fullGateExecution(['--remote', '--local']), /Choose one/);
  assert.throws(() => fullGateExecution(['--local', '--status']), /cannot execute/);
});

test('local gates preserve all policy shards as distinct, bounded resumable lanes', () => {
  const lanes = localBrowserLanes();
  assert.equal(lanes.length, FULL_BROWSER_SHARDS + 1);
  assert.equal(
    new Set(lanes.slice(0, FULL_BROWSER_SHARDS).map(({ label }) => label)).size,
    FULL_BROWSER_SHARDS,
  );
  assert.deepEqual(
    lanes
      .slice(0, FULL_BROWSER_SHARDS)
      .map(({ argv }) => argv.find((arg) => arg.startsWith('--shard='))),
    Array.from(
      { length: FULL_BROWSER_SHARDS },
      (_, index) => `--shard=${index + 1}/${FULL_BROWSER_SHARDS}`,
    ),
  );
  for (const { argv } of lanes.slice(0, FULL_BROWSER_SHARDS)) {
    assert.ok(argv.includes('--project=chromium'));
    assert.ok(argv.includes('--workers=1'));
    assert.ok(argv.includes('--retries=0'));
    assert.ok(argv.includes('--update-snapshots=none'));
    assert.ok(
      !argv.includes('--max-failures'),
      'the full gate must report every selected failure, not stop after five',
    );
    assert.ok(!argv.some((arg) => /grep|last-failed|test-list/.test(arg)));
  }
  assert.deepEqual(lanes.at(-1), {
    label: 'Production demo E2E',
    argv: [process.execPath, 'scripts/quality/run-demo-dist-e2e.mjs'],
  });
});

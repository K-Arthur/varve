import assert from 'node:assert/strict';
import test from 'node:test';

import { nativeSmokePlan } from './native-smoke.mjs';

test('windows native smoke builds the real binary without the incompatible test plugin', () => {
  const plan = nativeSmokePlan({ platform: 'win32' });
  assert.equal(plan.mode, 'launch');
  assert.deepEqual(plan.buildArgs.slice(0, 4), ['tauri', 'build', '--debug', '--no-bundle']);
  // The WebDriver plugin cannot link against webview2-com 0.39/windows 0.62, so
  // the Windows smoke must not enable its feature or its capability set.
  assert.equal(plan.buildArgs.includes('--features'), false);
  assert.equal(plan.buildArgs.includes('wdio'), false);
  assert.ok(plan.buildArgs.includes('src-tauri/tauri.smoke.conf.json'), plan.buildArgs.join(' '));
  assert.match(plan.binaryPath.replaceAll('\\', '/'), /target\/debug\/varve-desktop\.exe$/);
  assert.equal(plan.processName, 'varve-desktop');
  assert.equal(plan.wdioArgs, undefined);
});

test('linux and macOS native smoke keep driving the app through webdriver', () => {
  for (const platform of ['linux', 'darwin']) {
    const plan = nativeSmokePlan({ platform });
    assert.equal(plan.mode, 'wdio', platform);
    assert.ok(plan.buildArgs.includes('--features'), platform);
    assert.ok(plan.buildArgs.includes('wdio'), platform);
    assert.deepEqual(plan.wdioArgs, ['exec', 'wdio', 'run', 'wdio.conf.ts'], platform);
    assert.match(plan.binaryPath.replaceAll('\\', '/'), /target\/debug\/varve-desktop$/, platform);
  }
});

test('window wait is bounded and configurable', () => {
  assert.equal(nativeSmokePlan({ platform: 'win32' }).windowTimeoutMs, 90_000);
  assert.equal(
    nativeSmokePlan({ platform: 'win32', windowTimeoutMs: 5_000 }).windowTimeoutMs,
    5_000,
  );
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { nativeSmokePlan, runNativeDesktopCommand } from './native-smoke.mjs';

function stopFixtureRenderer(pidFile) {
  try {
    const pid = Number(readFileSync(pidFile));
    if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
  }
}

async function withLingeringRenderer(exitCode, assertion) {
  const directory = mkdtempSync(join(tmpdir(), 'varve-native-smoke-shutdown-'));
  const pidFile = join(directory, 'renderer.pid');
  const launcher = join(directory, 'launcher.cjs');
  writeFileSync(
    launcher,
    `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e',
  'setInterval(() => {}, 1000); process.send(process.pid);'
], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
child.once('message', pid => {
  require('node:fs').writeFileSync(process.argv[2], String(pid));
  setTimeout(() => process.exit(${exitCode}), 500);
});
`,
  );
  try {
    await assertion([process.execPath, launcher, pidFile], () => Number(readFileSync(pidFile)));
  } finally {
    // A failed cleanup assertion must not leave this test's controlled helper alive.
    stopFixtureRenderer(pidFile);
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertRendererStopped(pid) {
  // A reparented zombie has already exited; its OS reaper owns its final entry.
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      assert.equal(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0], 'Z');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test('native smoke awaits cleanup of a real renderer outliving a successful launcher', {
  skip: process.platform === 'win32',
}, async () => {
  await withLingeringRenderer(0, async (argv, rendererPid) => {
    await runNativeDesktopCommand(argv);
    assertRendererStopped(rendererPid());
  });
});

test('native smoke preserves a launcher failure while cleaning up its real renderer', {
  skip: process.platform === 'win32',
}, async () => {
  await withLingeringRenderer(7, async (argv, rendererPid) => {
    await assert.rejects(runNativeDesktopCommand(argv), /failed with exit code 7/);
    assertRendererStopped(rendererPid());
  });
});

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

#!/usr/bin/env node
/**
 * Native desktop smoke.
 *
 * Linux and macOS drive the real app through WebDriver (`wdio`). Windows cannot:
 * the WebDriver plugin is a test-only crate whose Windows glue is built against
 * `webview2-com 0.38` / `windows 0.61`, while the shipped Tauri line resolves
 * `webview2-com 0.39` / `windows 0.62`. `tauri-plugin-updater` and
 * `tauri-plugin-fs` require `tauri ^2.12`, so pinning back is not an option
 * without reintroducing the advisories those minimums fix, and the plugin cannot
 * link against the newer COM surface.
 *
 * Windows therefore runs a real build-and-launch smoke instead of a skipped
 * lane: it compiles the exact binary the desktop app builds without the test
 * plugin and proves the process reaches a real main window. That keeps the
 * Windows artifact validated while the UI-level WebDriver specs continue to run
 * where the plugin is compatible.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const DESKTOP_DIR = resolve(REPO_ROOT, 'apps', 'desktop');
const TEST_CONFIG_ARG = '--config src-tauri/tauri.test.conf.json';
// The smoke build runs the app without the WebDriver capability it cannot link,
// so it must not reference the wdio capability the test config declares.
const SMOKE_CONFIG_ARG = '--config src-tauri/tauri.smoke.conf.json';

/** Pure build/run plan, unit-tested without a display or a toolchain. */
export function nativeSmokePlan({ platform, windowTimeoutMs = 90_000 } = {}) {
  if (platform === 'win32') {
    return {
      mode: 'launch',
      buildArgs: ['tauri', 'build', '--debug', '--no-bundle', ...SMOKE_CONFIG_ARG.split(' ')],
      binaryPath: resolve(DESKTOP_DIR, 'src-tauri', 'target', 'debug', 'varve-desktop.exe'),
      processName: 'varve-desktop',
      windowTimeoutMs,
    };
  }
  return {
    mode: 'wdio',
    buildArgs: [
      'tauri',
      'build',
      '--debug',
      '--no-bundle',
      ...TEST_CONFIG_ARG.split(' '),
      '--features',
      'wdio',
    ],
    binaryPath: resolve(DESKTOP_DIR, 'src-tauri', 'target', 'debug', 'varve-desktop'),
    wdioArgs: ['exec', 'wdio', 'run', 'wdio.conf.ts'],
    windowTimeoutMs,
  };
}

function runPnpm(args, extraEnv = {}) {
  const result = spawnSync('pnpm', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status ?? 'null'}`);
  }
}

/** True once a process with a real main window exists. */
export function hasMainWindow(processName) {
  if (process.platform !== 'win32') return false;
  const script = [
    `$p = Get-Process -Name ${processName} -ErrorAction SilentlyContinue |`,
    'Where-Object { $_.MainWindowHandle -ne 0 } |',
    "Select-Object -First 1; if ($p) { 'WINDOW' } else { 'NOWINDOW' }",
  ].join(' ');
  const probe = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });
  return probe.status === 0 && probe.stdout.trim() === 'WINDOW';
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function launchSmoke(plan) {
  if (!existsSync(plan.binaryPath)) {
    throw new Error(`desktop binary not found after build: ${plan.binaryPath}`);
  }
  const child = spawn(plan.binaryPath, [], { cwd: REPO_ROOT, stdio: 'inherit' });
  let exited = null;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });
  const deadline = Date.now() + plan.windowTimeoutMs;
  try {
    while (Date.now() < deadline) {
      if (exited) {
        throw new Error(
          `desktop app exited before opening a window (code ${exited.code ?? 'null'}${exited.signal ? `, signal ${exited.signal}` : ''})`,
        );
      }
      if (await hasMainWindow(plan.processName)) {
        console.log('native desktop smoke: main window observed');
        return;
      }
      await sleep(2_000);
    }
    throw new Error(`desktop app did not open a main window within ${plan.windowTimeoutMs}ms`);
  } finally {
    if (!exited) {
      child.kill();
      // A wedged GUI process must not leak into the next CI step.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
  }
}

async function main() {
  const plan = nativeSmokePlan({ platform: process.platform });
  console.log(`native desktop smoke: ${plan.mode} (${process.platform})`);
  runPnpm(['--dir', DESKTOP_DIR, ...plan.buildArgs]);
  if (plan.mode === 'wdio') {
    runPnpm(plan.wdioArgs);
    return;
  }
  await launchSmoke(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`native desktop smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}

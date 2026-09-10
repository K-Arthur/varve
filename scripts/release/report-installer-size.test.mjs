#!/usr/bin/env node
/**
 * Unit tests for the installer size report/gate.
 *
 * Run: node scripts/release/report-installer-size.test.mjs
 * Wired into the regression suite (pnpm test:ci:tools).
 *
 * The 7-Zip parsing path is additionally exercised against real released
 * installers in the release workflow (report-installer-size.mjs runs after
 * artifact collection on every release).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeInstaller,
  archFromFilename,
  classifyEntry,
  DEFAULT_BASELINE,
  webviewModeFromEntries,
} from './report-installer-size.mjs';

const no7z = null;

function withTempFile(bytes, filename, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'varve-size-gate-'));
  const path = join(dir, filename);
  writeFileSync(path, Buffer.alloc(bytes));
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('classifies NSIS payload entries by role', () => {
  assert.equal(
    classifyEntry('$TEMP/MicrosoftEdgeWebView2RuntimeInstaller.exe'),
    'webviewInstaller',
  );
  assert.equal(classifyEntry('varve-desktop.exe'), 'appBinary');
  assert.equal(classifyEntry('onnxruntime-libs/windows-x86_64/onnxruntime.dll'), 'onnxRuntime');
  assert.equal(classifyEntry('$PLUGINSDIR/nsis_tauri_utils.dll'), 'nsisPlugins');
  assert.equal(classifyEntry('uninstall.exe'), 'uninstaller');
});

test('derives arch tokens from release filenames', () => {
  assert.equal(archFromFilename('Varve-0.1.2-windows-x86_64.exe'), 'x86_64');
  assert.equal(archFromFilename('Varve-0.1.2-windows-aarch64.exe'), 'aarch64');
  assert.equal(archFromFilename('Varve-0.1.2-macos-aarch64.dmg'), 'aarch64');
});

test('detects the embedded WebView2 mode from payload entries', () => {
  const offline = [{ name: '$TEMP/MicrosoftEdgeWebView2RuntimeInstaller.exe' }];
  const bootstrapper = [{ name: 'varve-desktop.exe' }];
  assert.equal(webviewModeFromEntries(offline), 'offlineInstaller');
  assert.equal(webviewModeFromEntries(bootstrapper), 'bootstrapper');
});

test('status is ok inside warn threshold', () => {
  withTempFile(50_000_000, 'Varve-0.1.3-windows-x86_64.exe', (path) => {
    const r = analyzeInstaller({
      installerPath: path,
      baseline: DEFAULT_BASELINE,
      overrideReason: null,
      sevenZip: no7z,
    });
    assert.equal(r.status, 'ok');
    assert.equal(r.decomposed, false);
  });
});

test('status warns past warnRatio and blocks past blockRatio', () => {
  withTempFile(70_000_000, 'Varve-0.1.3-windows-x86_64.exe', (warnPath) => {
    const warn = analyzeInstaller({
      installerPath: warnPath,
      baseline: DEFAULT_BASELINE,
      overrideReason: null,
      sevenZip: no7z,
    });
    assert.equal(warn.status, 'warn');
  });

  withTempFile(80_000_000, 'Varve-0.1.3-windows-x86_64.exe', (blockPath) => {
    const block = analyzeInstaller({
      installerPath: blockPath,
      baseline: DEFAULT_BASELINE,
      overrideReason: null,
      sevenZip: no7z,
    });
    assert.equal(block.status, 'block');
  });
});

test('an explicit override converts a block into block-overridden and records the reason', () => {
  withTempFile(80_000_000, 'Varve-0.1.3-windows-x86_64.exe', (path) => {
    const r = analyzeInstaller({
      installerPath: path,
      baseline: DEFAULT_BASELINE,
      overrideReason: 'intentional model addition',
      sevenZip: no7z,
    });
    assert.equal(r.status, 'block-overridden');
    assert.equal(r.overrideReason, 'intentional model addition');
  });
});

test('artifacts without a baseline entry are reported without a gate', () => {
  withTempFile(1024, 'Varve-0.1.3-linux-x86_64.AppImage', (path) => {
    const r = analyzeInstaller({
      installerPath: path,
      baseline: DEFAULT_BASELINE,
      overrideReason: null,
      sevenZip: no7z,
    });
    assert.equal(r.expectedBytes, null);
    assert.equal(r.status, 'ok');
  });
});

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (err) {
    process.stderr.write(`not ok - ${name}\n  ${err.message}\n`);
    process.exitCode = 1;
  }
}

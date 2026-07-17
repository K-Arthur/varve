import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  evaluateDisplay,
  evaluateLinuxDependencies,
  evaluateWdioCompatibility,
  getLinuxInstallHint,
} from './compatibility.mjs';

test('reports a missing native-utils export before WDIO starts', () => {
  const report = evaluateWdioCompatibility({
    serviceVersion: '1.2.0',
    nativeUtilsVersion: '2.4.0',
    nativeUtilsExports: [],
  });

  assert.equal(report.ok, false);
  assert.match(report.issues[0], /installMockSyncOverride/);
  assert.match(report.remediation, /2\.5\.0/);
});

test('accepts a native-utils version that exports the required WDIO API', () => {
  const report = evaluateWdioCompatibility({
    serviceVersion: '1.2.0',
    nativeUtilsVersion: '2.5.0',
    nativeUtilsExports: ['installMockSyncOverride'],
  });

  assert.deepEqual(report, { ok: true, issues: [], remediation: null });
});

test('only checks Linux runtime libraries on Linux', () => {
  const windows = evaluateLinuxDependencies({ platform: 'win32', pkgConfig: {} });
  const linux = evaluateLinuxDependencies({
    platform: 'linux',
    pkgConfig: { 'gtk+-3.0': '3.24.52', 'webkit2gtk-4.1': null },
  });

  assert.deepEqual(windows, { ok: true, issues: [] });
  assert.equal(linux.ok, false);
  assert.match(linux.issues[0], /webkit2gtk-4\.1/);
});

test('reports a missing Linux display for native GUI runs', () => {
  const report = evaluateDisplay({
    platform: 'linux',
    sessionType: '',
    waylandDisplay: '',
    display: '',
  });

  assert.equal(report.ok, false);
  assert.match(report.remediation, /Xvfb|Weston/);
});

test('maps supported Linux families to explicit install guidance', () => {
  assert.match(getLinuxInstallHint('arch'), /pacman/);
  assert.match(getLinuxInstallHint('ubuntu'), /apt/);
  assert.match(getLinuxInstallHint('fedora'), /dnf/);
});

test('preflight resolves package metadata through export maps', () => {
  const result = spawnSync(process.execPath, ['scripts/desktop/preflight.mjs', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const report = JSON.parse(result.stdout);

  assert.doesNotMatch(
    report.webdriver.wdio.issues.join('\n'),
    /Package subpath '\.\/package\.json'/,
  );
  assert.match(report.webdriver.wdio.issues.join('\n'), /@wdio\/tauri-service@1\.2\.0/);
});

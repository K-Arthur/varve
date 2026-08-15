import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  evaluateDisplay,
  evaluateLinuxDependencies,
  evaluateWdioCompatibility,
  evaluateWindowsWebView2,
  getLinuxInstallHint,
  parseWindowsWebView2Version,
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

test('requires WebView2 only on Windows', () => {
  assert.deepEqual(evaluateWindowsWebView2({ platform: 'darwin', version: null }), {
    ok: true,
    issues: [],
    remediation: null,
  });

  const report = evaluateWindowsWebView2({ platform: 'win32', version: null });
  assert.equal(report.ok, false);
  assert.match(report.remediation, /WebView2/);
});

test('parses the WebView2 version from standard registry output', () => {
  assert.equal(
    parseWindowsWebView2Version(
      '    pv    REG_SZ    138.0.3351.121\r\n    name  REG_SZ    Microsoft Edge WebView2 Runtime',
    ),
    '138.0.3351.121',
  );
  assert.equal(
    parseWindowsWebView2Version('ERROR: The system was unable to find the specified registry key.'),
    null,
  );
});

test('uses the documented Evergreen WebView2 client registry key', () => {
  const preflight = readFileSync('scripts/desktop/preflight.mjs', 'utf8');
  assert.match(preflight, /F3017226-FE2A-4295-8BDF-00C3A9A7E4C5/);
  assert.doesNotMatch(preflight, /F1E7E4A3-5D8A-4A42-BB8B-D0D444CBAE6D/);
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
  assert.equal(report.webdriver.wdio.ok, true);
});

test('repository pins the tested WDIO compatibility set', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(manifest.devDependencies['@wdio/tauri-service'], '1.3.0');
  assert.equal(manifest.devDependencies['@wdio/tauri-plugin'], '1.3.0');
  const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
  assert.match(workspace, /"@wdio\/native-utils": 2\.5\.0/);
});

test('native test config uses the current Tauri capability namespace', () => {
  const config = readFileSync('wdio.conf.ts', 'utf8');

  assert.match(config, /'tauri:options':/);
  assert.doesNotMatch(config, /wdio:tauri:options/);
  assert.match(config, /driverProvider: 'embedded'/);
});

test('default native lane excludes fixture-only updater specs', () => {
  const config = readFileSync('wdio.conf.ts', 'utf8');

  assert.match(config, /tauri-smoke\.e2e\.ts/);
  assert.match(config, /native-menu\.e2e\.ts/);
  assert.doesNotMatch(config, /tests\/wdio\/\*\*\/\*\.ts/);
  assert.match(config, /VARVE_WDIO_SPECS/);
});

test('WDIO permissions and bridge are excluded from normal desktop builds', () => {
  const releaseConfig = readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8');
  const testConfig = readFileSync('apps/desktop/src-tauri/tauri.test.conf.json', 'utf8');
  const capability = readFileSync('apps/desktop/src-tauri/tests/wdio-capability.json', 'utf8');
  const entrypoint = readFileSync('apps/desktop/src/main.tsx', 'utf8');

  assert.match(releaseConfig, /"capabilities": \["default"\]/);
  assert.match(testConfig, /"capabilities": \["default", "wdio"\]/);
  assert.match(capability, /"wdio:default"/);
  assert.match(capability, /"wdio-webdriver:default"/);
  assert.match(entrypoint, /import\('@wdio\/tauri-plugin'\)/);
  assert.match(entrypoint, /buildMode === 'wdio'/);
});

test('Windows packages use Tauri offline WebView2 installation at the bundle level', () => {
  const releaseConfig = readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8');

  assert.match(
    releaseConfig,
    /"windows":\s*\{\s*"webviewInstallMode":\s*\{\s*"type":\s*"offlineInstaller"/s,
  );
});

test('build.rs conditionally copies and cleans wdio capability', () => {
  const buildRs = readFileSync('apps/desktop/src-tauri/build.rs', 'utf8');
  const capability = readFileSync('apps/desktop/src-tauri/tests/wdio-capability.json', 'utf8');
  const gitignore = readFileSync('apps/desktop/src-tauri/.gitignore', 'utf8');

  // build.rs copies the capability only with the wdio feature
  assert.match(buildRs, /#\[cfg\(feature = "wdio"\)\]/);
  assert.match(buildRs, /tests\/wdio-capability\.json/);

  // build.rs removes stale capability when wdio is NOT enabled
  assert.match(buildRs, /#\[cfg\(not\(feature = "wdio"\)\)\]/);
  assert.match(buildRs, /remove_file/);

  // The build artifact is gitignored so it never accidentally gets committed
  assert.match(gitignore, /capabilities\/wdio\.json/);

  // The source file should be valid JSON
  const parsed = JSON.parse(capability);
  assert.equal(parsed.identifier, 'wdio');
  assert.ok(parsed.permissions.includes('wdio:default'));
  assert.ok(parsed.permissions.includes('wdio-webdriver:default'));
});

test('engine sources do not retain obsolete no-op declarations', () => {
  const workerPool = readFileSync('packages/engine/src/backgroundRemoval/workerPool.ts', 'utf8');
  const replay = readFileSync('packages/engine/src/replay.ts', 'utf8');
  const traceFit = readFileSync('packages/engine/src/traceBezierFit.ts', 'utf8');

  assert.doesNotMatch(workerPool, /const _cleanup = \(\) =>/);
  assert.doesNotMatch(replay, /\bapplyLayerBlur,\n/);
  assert.doesNotMatch(traceFit, /const a11 = 0;|const a12 = 0;|const a22 = 0;/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  process.env.VARVE_NATIVE_WORKFLOW_FIXTURE || '.github/workflows/release.yml',
  'utf8',
);
function job(id) {
  const from = source.indexOf(`\n  ${id}:`);
  assert.ok(from >= 0);
  const after = source.slice(from + 1).search(/\n {2}[a-z][a-z0-9-]*:/);
  return source.slice(from, after < 0 ? source.length : from + 1 + after);
}
const linux = job('package-smoke'),
  native = job('platform-smoke'),
  verify = job('verify');
assert.match(
  verify,
  /needs: \[preflight, signing-preflight, bundle, package-smoke, platform-smoke\]/,
  'Both owning native gates remain prerequisites for draft bytes',
);
for (const slice of [linux, native]) {
  assert.match(slice, /Select successful .*producer artifact/);
  assert.match(slice, /Verify downloaded .*source and bytes/);
  assert.match(slice, /production\/published-upgrade\.mjs/);
  assert.match(
    slice,
    /Preserve actual native qualification evidence\n\s+if: always\(\) && matrix\.enabled/,
  );
  assert.doesNotMatch(
    slice,
    /continue-on-error:/,
    'Native qualification failure may not turn green',
  );
}
assert.ok(
  linux.indexOf('Published Linux production disk seed') <
    linux.indexOf('Actual upgraded Linux production qualification'),
);
assert.ok(
  linux.indexOf('Actual upgraded Linux production qualification') <
    linux.indexOf('sudo apt-get remove -y'),
);
assert.match(linux, /2\.21 true/);
assert.match(linux, /2\.33 false/);
assert.match(linux, /tauri-driver --version 2\.1\.0 --locked/);
const windowsStart = native.indexOf('Windows — silent install,'),
  macStart = native.indexOf('macOS — mount DMG');
const windows = native.slice(windowsStart, macStart),
  mac = native.slice(macStart);
assert.ok(
  windows.indexOf('Published Windows production disk seed') <
    windows.indexOf('Installing $($exe.Name) silently'),
);
assert.ok(
  windows.indexOf('Actual upgraded Windows production qualification') <
    windows.indexOf('Start-Process -FilePath $uninstallKey.UninstallString'),
);
assert.match(windows, /Actual Windows native profile changed during upgrade/);
assert.match(mac, /ditto "\$OLD_APP" "\$INSTALL"/);
assert.match(mac, /ditto "\$APP" "\$INSTALL"/);
assert.ok(
  mac.indexOf('Published macOS production disk seed') <
    mac.indexOf('Actual upgraded macOS production qualification'),
);
const session = readFileSync(new URL('./macos-session.sh', import.meta.url), 'utf8');
assert.ok(session.indexOf('macos-ax-probe.mjs') < session.indexOf('macos-production.mjs'));
assert.doesNotMatch(session, /\|\|\s*true.*macos-production|macos-production[^\n]*\|\|\s*true/);
console.log(
  'Owning five-target production install/upgrade/functional gate ordering and failure evidence contracts passed.',
);

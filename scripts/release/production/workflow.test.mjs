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
  contracts = job('native-contracts'),
  verify = job('verify');
assert.match(job('bundle'), /needs: \[preflight, gate, signing-preflight, native-contracts\]/);
assert.match(contracts, /node-version: \$\{\{ env\.NODE_VERSION \}\}/);
assert.match(contracts, /assert\.equal\(process\.arch, process\.env\.EXPECTED_NODE_ARCH/);
assert.match(contracts, /pdfOwner\('@napi-rs\/canvas'\)/);
assert.match(contracts, /createCanvas\(2, 2\)\.toBuffer\('image\/png'\)/);
assert.doesNotMatch(contracts, /continue-on-error:/);
assert.ok(
  contracts.indexOf('pnpm install --frozen-lockfile') <
    contracts.indexOf('Native qualification adapter contracts'),
);
for (const target of [
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
  'windows-aarch64',
  'macos-aarch64',
]) {
  assert.match(contracts, new RegExp(`name: ${target}\\n`));
}
assert.match(linux, /production\/appimage-extraction\.test\.mjs/);
assert.doesNotMatch(native, /production\/appimage-extraction\.test\.mjs/);
assert.match(
  verify,
  /needs: \[preflight, signing-preflight, bundle, package-smoke, platform-smoke\]/,
  'Both owning native gates remain prerequisites for draft bytes',
);
for (const slice of [linux, native]) {
  assert.match(
    slice,
    /needs\.native-contracts\.result == 'success'/,
    'Failed early contracts do not launch installed sessions',
  );
  assert.match(
    slice,
    /name: Native qualification adapter contracts\n\s+if: matrix.enabled\n\s+shell: bash/,
    'adapter regressions run under Bash errexit on every native platform',
  );
  assert.match(slice, /Checkout workflow-pinned native qualification tooling/);
  assert.match(slice, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(
    slice,
    /VARVE_NATIVE_WORKFLOW_FIXTURE: release-qualification-tooling\/\.github\/workflows\/release\.yml/,
  );
  assert.doesNotMatch(slice, /(?:node|bash) scripts\/release\/production\//);
  assert.match(slice, /production\/retained-document\.test\.mjs/);
  assert.match(slice, /production\/native-quit\.test\.mjs/);
  assert.match(slice, /production\/native-export-controls\.test\.mjs/);
  assert.match(slice, /production\/native-pdf\.test\.mjs/);
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
assert.equal((windows.match(/pwsh -NoProfile -File .*windows-session\.ps1/g) ?? []).length, 2);
assert.match(
  windows,
  /verify-license-payload\.mjs --resource-root \$installed\.DirectoryName\n\s+if \(\$LASTEXITCODE -ne 0\)/,
  'the installed Windows resource payload is checked and failure remains fatal',
);
assert.match(mac, /ditto "\$OLD_APP" "\$INSTALL"/);
assert.match(mac, /ditto "\$APP" "\$INSTALL"/);
assert.match(
  mac,
  /verify-license-payload\.mjs \\\n\s+--resource-root "\$INSTALL\/Contents\/Resources"/,
  'the installed macOS DMG payload is checked',
);
assert.match(
  mac,
  /python scripts\/release\/extract_updater_archive\.py "\$\{UPDATER_ARCHIVE\}" "\$\{UPDATER_TMP\}"/,
  'the macOS updater archive is safely extracted with a Bash 3.2-compatible runner command',
);
assert.match(
  mac,
  /verify-license-payload\.mjs \\\n\s+--resource-root "\$\{UPDATER_APP\}\/Contents\/Resources"/,
  'the updater archive resource payload is checked',
);
assert.match(
  linux,
  /verify-license-payload\.mjs \\\n\s+--resource-root "\$\{EXTRACT_ROOT\}\/squashfs-root\/usr\/lib\/Varve"/,
  'the post-prune AppImage payload is extracted and checked',
);
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

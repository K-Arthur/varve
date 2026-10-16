#!/usr/bin/env node
/**
 * Regression: hash_for must treat the checksum filename as a whole field.
 * A sibling `.AppImage.sig` line used to match via grep -F substring and
 * emit two hashes into PKGBUILD.
 *
 * Also: update_aur_pkgbuild must rewrite pkgver plus both per-arch
 * sha256sums_* arrays. A single sha256sums=(...) replacement misses the
 * current PKGBUILD and leaves .SRCINFO stale.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(root, 'update-packaging.sh');
const script = readFileSync(scriptPath, 'utf8');

const hashForFn = script.match(/^hash_for\(\) \{[\s\S]*?^}/m);
assert.ok(hashForFn, 'update-packaging.sh must define hash_for()');
assert.match(
  hashForFn[0],
  /awk -v name="\$name" '\$2 == name \{print \$1\}'/,
  'hash_for must match the checksum filename as a whole field',
);

const curlInvocations = [...script.matchAll(/\bcurl\b[^\n]+/g)].map((m) => m[0]);
assert.ok(curlInvocations.length >= 3, 'expected checksum, AppImage, and GitHub API curls');
for (const invocation of curlInvocations) {
  assert.match(invocation, /--connect-timeout\s+\d+/, `missing --connect-timeout: ${invocation}`);
  assert.match(invocation, /--max-time\s+\d+/, `missing --max-time: ${invocation}`);
}

const APPIMAGE = 'Varve-0.5.1-linux-x86_64.AppImage';
const SIG = `${APPIMAGE}.sig`;
const APP_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SIG_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ARM = 'Varve-0.5.1-linux-aarch64.AppImage';
const ARM_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

function runHashFor(sums, name) {
  const bash = `
set -euo pipefail
SHA256SUMS=$(cat <<'EOF'
${sums}
EOF
)
die() { echo ":: ERROR: $*" >&2; exit 1; }
${hashForFn[0]}
hash_for ${JSON.stringify(name)}
`;
  return spawnSync('bash', ['-c', bash], { encoding: 'utf8' });
}

const siblingSums = `${APP_HASH}  ${APPIMAGE}
${SIG_HASH}  ${SIG}
${ARM_HASH}  ${ARM}
`;

{
  const result = runHashFor(siblingSums, APPIMAGE);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), APP_HASH);
  assert.doesNotMatch(result.stdout, new RegExp(SIG_HASH));
}

{
  const result = runHashFor(siblingSums, ARM);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), ARM_HASH);
}

{
  const dup = `${APP_HASH}  ${APPIMAGE}
${SIG_HASH}  ${APPIMAGE}
`;
  const result = runHashFor(dup, APPIMAGE);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one/i);
}

{
  const missing = `${SIG_HASH}  ${SIG}
`;
  const result = runHashFor(missing, APPIMAGE);
  assert.notEqual(result.status, 0);
}

{
  const short = `deadbeef  ${APPIMAGE}
`;
  const result = runHashFor(short, APPIMAGE);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /64/i);
}

const updateFn = script.match(/^update_aur_pkgbuild\(\) \{[\s\S]*?^}/m);
assert.ok(updateFn, 'update-packaging.sh must define update_aur_pkgbuild()');
assert.match(updateFn[0], /pkgver=/);
assert.match(updateFn[0], /sha256sums_x86_64=/);
assert.match(updateFn[0], /sha256sums_aarch64=/);
assert.doesNotMatch(
  updateFn[0],
  /sed[^\n]*\^sha256sums=\(/,
  'must not edit a single sha256sums=(...) line as the hash update',
);
assert.match(
  script,
  /update_aur_pkgbuild\s+"\$PKGBUILD"\s+"\$VERSION"\s+"\$AUR_SHA_X86"\s+"\$AUR_SHA_ARM"/,
  'script must apply pkgver and both arch hashes to the live PKGBUILD',
);
assert.match(
  script,
  /makepkg --printsrcinfo > \.SRCINFO/,
  'script must regenerate .SRCINFO from the updated PKGBUILD',
);

const OLD_X86 = '1111111111111111111111111111111111111111111111111111111111111111';
const OLD_ARM = '2222222222222222222222222222222222222222222222222222222222222222';
const NEW_X86 = '3333333333333333333333333333333333333333333333333333333333333333';
const NEW_ARM = '4444444444444444444444444444444444444444444444444444444444444444';
const SINGLE = '5555555555555555555555555555555555555555555555555555555555555555';

function runUpdate(pkgbuildText, version, shaX86, shaArm) {
  const dir = mkdtempSync(join(tmpdir(), 'varve-pkgbuild-'));
  const file = join(dir, 'PKGBUILD');
  writeFileSync(file, pkgbuildText);
  const bash = `
set -euo pipefail
die() { echo ":: ERROR: $*" >&2; exit 1; }
${updateFn[0]}
update_aur_pkgbuild ${JSON.stringify(file)} ${JSON.stringify(version)} ${JSON.stringify(shaX86)} ${JSON.stringify(shaArm)}
`;
  const result = spawnSync('bash', ['-c', bash], { encoding: 'utf8' });
  const text = readFileSync(file, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { result, text };
}

{
  const fixture = `pkgver=0.5.0
pkgrel=1
sha256sums=('${SINGLE}')
sha256sums_x86_64=('${OLD_X86}')
sha256sums_aarch64=('${OLD_ARM}')
`;
  const { result, text } = runUpdate(fixture, '0.5.1', NEW_X86, NEW_ARM);
  assert.equal(result.status, 0, result.stderr);
  assert.match(text, /^pkgver=0\.5\.1$/m);
  assert.match(text, new RegExp(`^sha256sums_x86_64=\\('${NEW_X86}'\\)$`, 'm'));
  assert.match(text, new RegExp(`^sha256sums_aarch64=\\('${NEW_ARM}'\\)$`, 'm'));
  assert.match(
    text,
    new RegExp(`^sha256sums=\\('${SINGLE}'\\)$`, 'm'),
    'generic sha256sums=(...) must be left alone when per-arch arrays exist',
  );
}

{
  const legacy = `pkgver=0.5.0
sha256sums=('${SINGLE}')
`;
  const { result } = runUpdate(legacy, '0.5.1', NEW_X86, NEW_ARM);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sha256sums_x86_64 replacement failed/);
}

{
  const repoRoot = join(root, '..', '..');
  const pkgbuild = readFileSync(join(repoRoot, 'packaging/aur/varve-desktop-bin/PKGBUILD'), 'utf8');
  const srcinfo = readFileSync(join(repoRoot, 'packaging/aur/varve-desktop-bin/.SRCINFO'), 'utf8');
  const pkgver = pkgbuild.match(/^pkgver=(.+)$/m)?.[1];
  assert.ok(pkgver, 'PKGBUILD must declare pkgver');
  const x86 = pkgbuild.match(/^sha256sums_x86_64=\('([0-9a-fA-F]{64})'\)$/m)?.[1];
  const arm = pkgbuild.match(/^sha256sums_aarch64=\('([0-9a-fA-F]{64})'\)$/m)?.[1];
  assert.ok(x86 && arm, 'PKGBUILD must declare both per-arch sha256sums');
  assert.match(srcinfo, new RegExp(`^\\tpkgver = ${pkgver.replaceAll('.', '\\.')}$`, 'm'));
  assert.match(
    srcinfo,
    new RegExp(`noextract = Varve-${pkgver.replaceAll('.', '\\.')}-linux-x86_64\\.AppImage`),
  );
  assert.match(
    srcinfo,
    new RegExp(`noextract = Varve-${pkgver.replaceAll('.', '\\.')}-linux-aarch64\\.AppImage`),
  );
  assert.match(
    srcinfo,
    new RegExp(
      `source_x86_64 = Varve-${pkgver.replaceAll('.', '\\.')}-linux-x86_64\\.AppImage::.*/releases/download/v${pkgver.replaceAll('.', '\\.')}/`,
    ),
  );
  assert.match(
    srcinfo,
    new RegExp(
      `source_aarch64 = Varve-${pkgver.replaceAll('.', '\\.')}-linux-aarch64\\.AppImage::.*/releases/download/v${pkgver.replaceAll('.', '\\.')}/`,
    ),
  );
  assert.match(srcinfo, new RegExp(`^\\tsha256sums_x86_64 = ${x86}$`, 'm'));
  assert.match(srcinfo, new RegExp(`^\\tsha256sums_aarch64 = ${arm}$`, 'm'));
}

console.log('update-packaging-hash tests passed');

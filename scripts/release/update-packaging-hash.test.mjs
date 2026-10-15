#!/usr/bin/env node
/**
 * Regression: hash_for must treat the checksum filename as a whole field.
 * A sibling `.AppImage.sig` line used to match via grep -F substring and
 * emit two hashes into PKGBUILD.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

console.log('update-packaging-hash tests passed');

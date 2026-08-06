#!/usr/bin/env node
/**
 * Unit tests for the release pipeline scripts.
 *
 * Run: node scripts/release/release-pipeline.test.mjs
 * Wired into the regression suite (pnpm test:ci:tools).
 *
 * Fixture-based: all artifacts are synthetic, but the verification rules are
 * the same code paths the release pipeline and the website deploy run.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseChecksums, verifyReleaseIntegrity } from './verify-release-data.mjs';
import { buildWebsiteReleaseData, formatCopy } from './website-release-data.mjs';

const runValidator = (files) => {
  try {
    execFileSync(process.execPath, ['scripts/release/validate-sbom.mjs', ...files], {
      stdio: 'ignore',
    });
    return 0;
  } catch {
    return 1;
  }
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const FILE_A = Buffer.from('varve-installer-bytes-a');
const FILE_B = Buffer.from('varve-installer-bytes-b');
const HASH_A = sha256(FILE_A);
const HASH_B = sha256(FILE_B);

const FIXTURE_MANIFEST = {
  schemaVersion: 1,
  version: '0.1.0',
  generatedAt: '2026-08-06T10:00:00.000Z',
  signed: false,
  notarized: false,
  artifacts: [
    {
      filename: 'Varve-0.1.0-linux-x86_64.AppImage',
      os: 'linux',
      arch: 'x86_64',
      format: 'appimage',
      sizeBytes: FILE_A.length,
      sha256: HASH_A,
    },
    {
      filename: 'Varve-0.1.0-windows-x86_64.exe',
      os: 'windows',
      arch: 'x86_64',
      format: 'nsis',
      sizeBytes: FILE_B.length,
      sha256: HASH_B,
    },
  ],
};

const FIXTURE_ASSETS = [
  'Varve-0.1.0-linux-x86_64.AppImage',
  'Varve-0.1.0-windows-x86_64.exe',
  'Varve-0.1.0-sbom-linux-x86_64.cdx.json',
  'Varve-0.1.0-sbom-windows-x86_64.cdx.json',
  'release-manifest.json',
  'SHA256SUMS.txt',
];

const FIXTURE_CHECKSUMS =
  [
    `${HASH_A}  Varve-0.1.0-linux-x86_64.AppImage`,
    `${HASH_B}  Varve-0.1.0-windows-x86_64.exe`,
    `${sha256(Buffer.from('sbom-linux'))}  Varve-0.1.0-sbom-linux-x86_64.cdx.json`,
    `${sha256(Buffer.from('sbom-windows'))}  Varve-0.1.0-sbom-windows-x86_64.cdx.json`,
    `${sha256(Buffer.from('manifest'))}  release-manifest.json`,
  ].join('\n') + '\n';

function verifyFixture(overrides = {}) {
  return verifyReleaseIntegrity({
    tag: 'v0.1.0',
    manifest: FIXTURE_MANIFEST,
    checksumsText: FIXTURE_CHECKSUMS,
    assetNames: FIXTURE_ASSETS,
    ...overrides,
  });
}

// ── parseChecksums ───────────────────────────────────────────────────────────
{
  const parsed = parseChecksums(FIXTURE_CHECKSUMS);
  assert.equal(parsed.size, 5, 'parses all entries');
  assert.equal(parsed.get('Varve-0.1.0-linux-x86_64.AppImage'), HASH_A);
}

// Rejections: wrong format
const BAD_LINES = [
  ['deadbeef  file.txt', 'wrong hash length'],
  [`${HASH_A.toUpperCase()}  file.txt`, 'uppercase hash'],
  ['file-without-hash.txt', 'no two-space separator'],
  [`${HASH_A}  ../escape.txt`, 'path traversal'],
  [`${HASH_A}  /abs.txt`, 'absolute path'],
  [`${HASH_A}  a\nb.txt`, 'newline in filename'],
  ['', 'empty file'],
];
for (const [text, label] of BAD_LINES) {
  assert.throws(() => parseChecksums(text), undefined, `must reject ${label}`);
}

// Duplicate filenames
assert.throws(
  () => parseChecksums(`${HASH_A}  same.txt\n${HASH_B}  same.txt\n`),
  undefined,
  'must reject duplicate filenames',
);

// A one-byte mutation must fail verification
{
  const corrupted = FIXTURE_CHECKSUMS.replace(
    HASH_A,
    sha256(Buffer.concat([FILE_A, Buffer.from([1])])),
  );
  assert.throws(
    () => verifyFixture({ checksumsText: corrupted }),
    /Hash mismatch/,
    'mutated checksum byte must fail verification',
  );
}

// ── verifyReleaseIntegrity ───────────────────────────────────────────────────
{
  const result = verifyFixture();
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.sbomAssets.length, 2);
}

// Tag/version disagreement
assert.throws(
  () => verifyFixture({ tag: 'v0.2.0' }),
  /does not match tag/,
  'tag/version disagreement must be rejected',
);

// Missing asset in the checksum file
{
  const missing = FIXTURE_CHECKSUMS.replace(`${HASH_A}  Varve-0.1.0-linux-x86_64.AppImage\n`, '');
  assert.throws(
    () => verifyFixture({ checksumsText: missing }),
    /Hash mismatch.*\(absent\)/,
    'manifest asset absent from checksums must be rejected',
  );
}

// Phantom checksum entry (lists a file that is not a release asset)
assert.throws(
  () =>
    verifyFixture({
      checksumsText: `${FIXTURE_CHECKSUMS}${sha256(Buffer.from('x'))}  ghost.txt\n`,
    }),
  /not a release asset/,
  'phantom checksum entries must be rejected',
);

// Duplicate manifest filenames
assert.throws(
  () =>
    verifyFixture({
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [FIXTURE_MANIFEST.artifacts[0], FIXTURE_MANIFEST.artifacts[0]],
      },
    }),
  /duplicate filenames/,
  'duplicate manifest names must be rejected',
);

// Unknown artifact format
assert.throws(
  () =>
    verifyFixture({
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], format: 'apk' }],
      },
    }),
  /Unsupported artifact format "apk"/,
  'unknown format must be rejected',
);

// Unknown platform
assert.throws(
  () =>
    verifyFixture({
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], os: 'plan9' }],
      },
    }),
  /Unsupported platform "plan9"/,
  'unknown platform must be rejected',
);

// Unmanifested installer on the release
assert.throws(
  () => verifyFixture({ assetNames: [...FIXTURE_ASSETS, 'Varve-0.1.0-macos-aarch64.dmg'] }),
  /installer assets not listed/,
  'unmanifested installer must be rejected',
);

// Missing SBOM for an advertised platform
{
  const sbomWindowsLine = `${sha256(Buffer.from('sbom-windows'))}  Varve-0.1.0-sbom-windows-x86_64.cdx.json`;
  assert.throws(
    () =>
      verifyFixture({
        assetNames: FIXTURE_ASSETS.filter((n) => !n.includes('sbom-windows')),
        checksumsText: FIXTURE_CHECKSUMS.replace(`${sbomWindowsLine}\n`, ''),
      }),
    /no windows-specific or combined SBOM/,
    'missing platform SBOM must be rejected',
  );
}

// SBOM not covered by checksums
{
  const extraSbom = `${sha256(Buffer.from('sbom-linux'))}  Varve-0.1.0-sbom-linux-x86_64.cdx.json`;
  const checksumsWithoutSbom = FIXTURE_CHECKSUMS.replace(`${extraSbom}\n`, '');
  assert.throws(
    () => verifyFixture({ checksumsText: checksumsWithoutSbom }),
    /SBOM asset.*not covered by SHA256SUMS/,
    'unhashed SBOM must be rejected',
  );
}

// Malformed manifest
assert.throws(
  () => verifyFixture({ manifest: { ...FIXTURE_MANIFEST, version: 'garbage' } }),
  /does not match tag/,
  'non-semver manifest version must be rejected',
);

// Zero-byte / placeholder installer
{
  const tiny = Buffer.from('tiny');
  assert.throws(
    () =>
      verifyFixture({
        manifest: {
          ...FIXTURE_MANIFEST,
          artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], sizeBytes: 0, sha256: sha256(tiny) }],
        },
        checksumsText: `${FIXTURE_CHECKSUMS.replace(`${HASH_A}  Varve-0.1.0-linux-x86_64.AppImage\n`, '')}`,
      }),
    /no positive sizeBytes/,
    'zero-byte installer must be rejected',
  );
}

// ── buildWebsiteReleaseData ──────────────────────────────────────────────────
{
  const data = buildWebsiteReleaseData({
    repo: 'K-Arthur/varve',
    tag: 'v0.1.0',
    manifest: FIXTURE_MANIFEST,
    checksumsText: FIXTURE_CHECKSUMS,
    sbomFilenames: [
      'Varve-0.1.0-sbom-linux-x86_64.cdx.json',
      'Varve-0.1.0-sbom-windows-x86_64.cdx.json',
    ],
    integrity: 'verified',
  });

  assert.equal(data.hasRelease, true);
  assert.equal(data.version, '0.1.0');
  assert.equal(data.releaseDate, '2026-08-06');
  assert.equal(data.prerelease, false);
  assert.equal(data.signed, false);
  assert.equal(data.integrity, 'verified');
  assert.equal(
    data.checksumsUrl,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/SHA256SUMS.txt',
  );

  assert.deepEqual(Object.keys(data.platforms).sort(), ['linux', 'windows']);
  const linux = data.platforms.linux[0];
  assert.equal(
    linux.url,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/Varve-0.1.0-linux-x86_64.AppImage',
  );
  assert.equal(
    linux.sbomUrl,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/Varve-0.1.0-sbom-linux-x86_64.cdx.json',
  );
  assert.equal(linux.title, 'AppImage');
  assert.match(linux.install, /chmod \+x/);

  const windows = data.platforms.windows[0];
  assert.equal(windows.caveat.length > 0, true, 'unsigned Windows builds need a caveat');
}

// Combined SBOM fallback when no platform-specific SBOM exists
{
  const data = buildWebsiteReleaseData({
    repo: 'K-Arthur/varve',
    tag: 'v0.1.0',
    manifest: FIXTURE_MANIFEST,
    checksumsText: FIXTURE_CHECKSUMS,
    sbomFilenames: ['varve-0.1.0-sbom.cdx.json'],
    integrity: 'verified',
  });
  assert.equal(
    data.platforms.linux[0].sbomUrl,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/varve-0.1.0-sbom.cdx.json',
  );
  assert.equal(
    data.sbomUrl,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/varve-0.1.0-sbom.cdx.json',
  );
}

// Unknown format must never reach the page
assert.throws(
  () =>
    buildWebsiteReleaseData({
      repo: 'K-Arthur/varve',
      tag: 'v0.1.0',
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], format: 'tar.gz' }],
      },
      checksumsText: FIXTURE_CHECKSUMS,
      sbomFilenames: [],
    }),
  /unknown format/,
  'unknown formats must be refused by the page builder',
);

// ── formatCopy ───────────────────────────────────────────────────────────────
{
  const copy = formatCopy('Varve');
  for (const format of ['appimage', 'deb', 'rpm', 'nsis', 'msi', 'dmg']) {
    assert.ok(copy[format]?.title, `formatCopy must describe ${format}`);
    assert.ok(copy[format]?.install, `formatCopy must give install instructions for ${format}`);
  }
  // No formatCopy copy may tell users to disable OS security. The word
  // "disable" is only acceptable inside a "do not disable" warning.
  for (const entry of Object.values(copy)) {
    const text = JSON.stringify(entry);
    assert.ok(!/spctl --master-disable/.test(text), 'no master-disable instructions');
    assert.ok(
      !/(?:[^o]|\b)disable (gatekeeper|smartscreen|antivirus|windows security)/i.test(text) ||
        /(do not|don'?t|never)\s+disable/i.test(text),
      'no install copy may advise disabling OS security',
    );
  }
}

// ── SBOM validation (validate-sbom.mjs rules, in-process) ────────────────────
{
  const valid = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      tools: [{ vendor: 'K-Arthur', name: 'varve/generate-sbom.mjs', version: '1.0.0' }],
      component: {
        type: 'application',
        'bom-ref': 'pkg:generic/varve@0.1.0',
        name: 'Varve',
        version: '0.1.0',
      },
    },
    components: [
      {
        type: 'library',
        'bom-ref': 'pkg:cargo/tauri@2.0.0',
        name: 'tauri',
        version: '2.0.0',
        purl: 'pkg:cargo/tauri@2.0.0',
      },
    ],
  };
  const tmp = '/tmp/opencode/varve-sbom-fixture-valid.json';
  writeFileSync(tmp, JSON.stringify(valid));
  assert.equal(runValidator([tmp]), 0, 'valid SBOM passes');

  // Strata identity must fail
  const strata = JSON.parse(JSON.stringify(valid));
  strata.metadata.component.name = 'Strata';
  strata.metadata.component['bom-ref'] = 'pkg:generic/strata@0.1.0';
  strata.metadata.tools[0].vendor = 'Strata';
  writeFileSync('/tmp/opencode/varve-sbom-fixture-strata.json', JSON.stringify(strata));
  assert.notEqual(
    runValidator(['/tmp/opencode/varve-sbom-fixture-strata.json']),
    0,
    'Strata identity fails',
  );

  // strata: property names must fail
  const prop = JSON.parse(JSON.stringify(valid));
  prop.components[0].properties = [{ name: 'strata:provenanceStatus', value: 'unknown' }];
  writeFileSync('/tmp/opencode/varve-sbom-fixture-prop.json', JSON.stringify(prop));
  assert.notEqual(
    runValidator(['/tmp/opencode/varve-sbom-fixture-prop.json']),
    0,
    'strata: properties fail',
  );

  // duplicate bom-refs must fail
  const dup = JSON.parse(JSON.stringify(valid));
  dup.components.push({ ...dup.components[0] });
  writeFileSync('/tmp/opencode/varve-sbom-fixture-dup.json', JSON.stringify(dup));
  assert.notEqual(
    runValidator(['/tmp/opencode/varve-sbom-fixture-dup.json']),
    0,
    'duplicate bom-refs fail',
  );

  // malformed purl must fail
  const purl = JSON.parse(JSON.stringify(valid));
  purl.components[0].purl = 'not-a-purl';
  writeFileSync('/tmp/opencode/varve-sbom-fixture-purl.json', JSON.stringify(purl));
  assert.notEqual(
    runValidator(['/tmp/opencode/varve-sbom-fixture-purl.json']),
    0,
    'malformed purl fails',
  );

  // non-JSON must fail
  writeFileSync('/tmp/opencode/varve-sbom-fixture-bad.json', '{not json');
  assert.notEqual(runValidator(['/tmp/opencode/varve-sbom-fixture-bad.json']), 0, 'non-JSON fails');
}

// ── version.mjs agreement ─────────────────────────────────────────────────────
{
  const runVersion = (argv) =>
    execFileSync(process.execPath, ['scripts/release/version.mjs', ...argv], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  assert.equal(runVersion(['get']), '0.1.0', 'current version is 0.1.0');
  // The tag the release pipeline will actually verify against must agree.
  assert.match(
    runVersion(['verify', 'v0.1.0']),
    /All version manifests agree on 0\.1\.0\./,
    'verify v0.1.0 passes',
  );
  assert.throws(() => runVersion(['verify', 'v9.9.9']), undefined, 'verify wrong tag fails');
}

process.stdout.write('release-pipeline.test.mjs: all assertions passed\n');

#!/usr/bin/env node
/**
 * Unit tests for the release signing policy and trust gate.
 *
 * Run: node scripts/release/signing-policy.test.mjs
 * Wired into the regression suite (pnpm test:ci:tools).
 *
 * These tests mock signing-tool output ONLY to exercise the parser and the
 * control flow. Mocked signatures prove nothing about real signing — real
 * cryptographic verification happens inside the protected release workflow
 * (verify-windows-signature.ps1 / verify-macos-signature.sh).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findSigningReports,
  MODE_FAIL_CLOSED,
  MODE_SIGNED,
  MODE_UNSIGNED,
  platformSecretsPresent,
  readSigningReports,
  resolveSigningMode,
  resolveSigningPolicy,
  signingStateFromReport,
  verifyReleaseTrust,
} from './signing-policy.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const PRESENT = { apple: {}, azure: {}, both: {} };
for (const name of [
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_SIGNING_IDENTITY',
  'APPLE_API_ISSUER',
  'APPLE_API_KEY',
  'APPLE_API_KEY_P8_BASE64',
]) {
  PRESENT.apple[name] = true;
  PRESENT.both[name] = true;
}
for (const name of [
  'AZURE_SIGNING_CLIENT_ID',
  'AZURE_SIGNING_CLIENT_SECRET',
  'AZURE_SIGNING_TENANT_ID',
  'AZURE_SIGNING_ACCOUNT',
  'AZURE_SIGNING_PROFILE',
  'AZURE_SIGNING_ENDPOINT',
]) {
  PRESENT.azure[name] = true;
  PRESENT.both[name] = true;
}
const NONE = {};

// ── resolveSigningMode ──────────────────────────────────────────────────────
assert.equal(
  resolveSigningMode({
    platform: 'windows',
    channel: 'stable',
    expectSigned: false,
    secretsComplete: true,
  }),
  MODE_SIGNED,
  'stable + complete secrets → signed',
);
assert.equal(
  resolveSigningMode({
    platform: 'windows',
    channel: 'stable',
    expectSigned: false,
    secretsComplete: false,
  }),
  MODE_UNSIGNED,
  'stable + missing secrets → unsigned with honest labels (zero-cost policy)',
);
assert.equal(
  resolveSigningMode({
    platform: 'macos',
    channel: 'stable',
    expectSigned: false,
    secretsComplete: false,
  }),
  MODE_UNSIGNED,
  'macos stable + missing secrets → unsigned (zero-cost policy)',
);
assert.equal(
  resolveSigningMode({
    platform: 'windows',
    channel: 'stable',
    expectSigned: true,
    secretsComplete: false,
  }),
  MODE_FAIL_CLOSED,
  'stable + RELEASE_EXPECT_SIGNED + missing secrets → fail closed',
);
assert.equal(
  resolveSigningMode({
    platform: 'macos',
    channel: 'stable',
    expectSigned: true,
    secretsComplete: false,
  }),
  MODE_FAIL_CLOSED,
  'macos stable + RELEASE_EXPECT_SIGNED + missing secrets → fail closed',
);
assert.equal(
  resolveSigningMode({
    platform: 'windows',
    channel: 'prerelease',
    expectSigned: false,
    secretsComplete: false,
  }),
  MODE_UNSIGNED,
  'prerelease without expect-signed → unsigned allowed',
);
assert.equal(
  resolveSigningMode({
    platform: 'macos',
    channel: 'prerelease',
    expectSigned: true,
    secretsComplete: true,
  }),
  MODE_SIGNED,
  'prerelease + expect-signed + secrets → signed',
);
assert.equal(
  resolveSigningMode({
    platform: 'macos',
    channel: 'prerelease',
    expectSigned: true,
    secretsComplete: false,
  }),
  MODE_FAIL_CLOSED,
  'prerelease + expect-signed + no secrets → fail closed',
);
assert.equal(
  resolveSigningMode({
    platform: 'linux',
    channel: 'stable',
    expectSigned: true,
    secretsComplete: false,
  }),
  MODE_UNSIGNED,
  'linux never uses certificate signing',
);

// ── platformSecretsPresent ──────────────────────────────────────────────────
{
  const windows = platformSecretsPresent('windows', PRESENT.azure);
  assert.equal(windows.complete, true, 'windows secrets complete');
  const windowsPartial = platformSecretsPresent('windows', { AZURE_SIGNING_CLIENT_ID: true });
  assert.equal(windowsPartial.complete, false, 'windows secrets partial');
  assert.ok(
    windowsPartial.missing.includes('AZURE_SIGNING_CLIENT_SECRET'),
    'missing list names the gap',
  );

  const macosCert = platformSecretsPresent('macos', {
    APPLE_CERTIFICATE: true,
    APPLE_CERTIFICATE_PASSWORD: true,
    APPLE_SIGNING_IDENTITY: true,
    APPLE_ID: true,
    APPLE_PASSWORD: true,
    APPLE_TEAM_ID: true,
  });
  assert.equal(macosCert.complete, true, 'apple-id notarization trio works');
  assert.equal(platformSecretsPresent('macos', PRESENT.apple).complete, true, 'api-key trio works');
  assert.equal(
    platformSecretsPresent('macos', { APPLE_CERTIFICATE: true, APPLE_CERTIFICATE_PASSWORD: true })
      .complete,
    false,
    'certificate without notarization auth fails',
  );
  assert.equal(
    platformSecretsPresent('macos', { APPLE_CERTIFICATE: true }).complete,
    false,
    'certificate alone fails',
  );
}

// ── resolveSigningPolicy ────────────────────────────────────────────────────
{
  const stable = resolveSigningPolicy({
    channel: 'stable',
    expectSigned: false,
    secretPresence: { windows: PRESENT.azure, macos: PRESENT.apple },
  });
  assert.equal(stable.windows, MODE_SIGNED, 'stable policy signs windows');
  assert.equal(stable.macos, MODE_SIGNED, 'stable policy signs macos');
  assert.equal(stable.linux, MODE_UNSIGNED, 'stable policy never signs linux');

  const stableNoSecrets = resolveSigningPolicy({
    channel: 'stable',
    expectSigned: false,
    secretPresence: { windows: NONE, macos: NONE },
  });
  assert.equal(
    stableNoSecrets.windows,
    MODE_UNSIGNED,
    'stable without windows secrets ships unsigned (zero-cost policy)',
  );
  assert.equal(
    stableNoSecrets.macos,
    MODE_UNSIGNED,
    'stable without macos secrets ships unsigned (zero-cost policy)',
  );

  const prerelease = resolveSigningPolicy({
    channel: 'prerelease',
    expectSigned: false,
    secretPresence: { windows: NONE, macos: NONE },
  });
  assert.equal(
    prerelease.windows,
    MODE_UNSIGNED,
    'prerelease without expect-signed may be unsigned',
  );
  assert.equal(prerelease.macos, MODE_UNSIGNED, 'macos same');

  // Fork-PR safety: with zero secrets present, every platform resolves to
  // unsigned-or-fail-closed, never "signed" — even on a stable-looking tag.
  const fork = resolveSigningPolicy({
    channel: 'stable',
    expectSigned: true,
    secretPresence: { windows: NONE, macos: NONE },
  });
  assert.ok(
    Object.values(fork).every((m) => m !== MODE_SIGNED),
    'no secrets → no platform claims signed',
  );
}

// ── signingStateFromReport ──────────────────────────────────────────────────
{
  const windows = signingStateFromReport({
    platform: 'windows',
    report: {
      platform: 'windows',
      signed: true,
      verification: 'valid',
      publisher: 'CN=K-Arthur',
      timestamped: true,
      files: [{ filename: 'Varve-0.1.0-windows-x86_64.exe', status: 'Valid' }],
    },
  });
  assert.equal(windows.signed, true);
  assert.equal(windows.verification, 'valid');
  assert.equal(windows.timestamped, true);

  const macos = signingStateFromReport({
    platform: 'macos',
    report: {
      platform: 'macos',
      signed: true,
      notarized: true,
      stapled: true,
      hardenedRuntime: true,
      teamId: 'TEAMID1234',
    },
  });
  assert.equal(macos.notarized, true);
  assert.equal(macos.stapled, true);

  assert.equal(
    signingStateFromReport({ platform: 'windows', report: null }),
    null,
    'null report rejected',
  );
  assert.equal(
    signingStateFromReport({ platform: 'windows', report: { platform: 'macos' } }),
    null,
    'cross-platform report rejected',
  );
}

// ── verifyReleaseTrust: fail-closed policy ──────────────────────────────────
const FIXTURE_ARTIFACTS = [
  { filename: 'Varve-0.1.0-windows-x86_64.exe', os: 'windows', format: 'nsis' },
  { filename: 'Varve-0.1.0-macos-aarch64.dmg', os: 'macos', format: 'dmg' },
  { filename: 'Varve-0.1.0-linux-x86_64.AppImage', os: 'linux', format: 'appimage' },
];
const manifest = (overrides = {}) => ({
  version: '0.1.0',
  signed: false,
  notarized: false,
  artifacts: FIXTURE_ARTIFACTS,
  ...overrides,
});

const WINDOWS_OK = {
  platform: 'windows',
  signed: true,
  verification: 'valid',
  publisher: 'CN=K-Arthur',
  timestamped: true,
  checkedAt: '2026-08-08T00:00:00Z',
};
const MACOS_OK = {
  platform: 'macos',
  signed: true,
  notarized: true,
  stapled: true,
  hardenedRuntime: true,
  teamId: 'TEAMID1234',
  checkedAt: '2026-08-08T00:00:00Z',
};

// Stable release, no reports at all, RELEASE_EXPECT_SIGNED unset → unsigned
// artifacts are allowed (zero-cost policy); nothing must fail.
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: false,
    manifest: manifest(),
    reports: {},
  });
  assert.deepEqual(problems, [], 'stable without expect-signed never fails on missing reports');
}

// Stable release, RELEASE_EXPECT_SIGNED=true, no reports → fail closed.
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: true,
    manifest: manifest(),
    reports: {},
  });
  assert.ok(
    problems.some((p) => p.startsWith('windows: signing required')),
    'expect-signed stable without windows report fails',
  );
  assert.ok(
    problems.some((p) => p.startsWith('macos: signing required')),
    'expect-signed stable without macos report fails',
  );
}

// Stable release with valid reports → passes.
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: false,
    manifest: manifest({ signed: true, notarized: true }),
    reports: { windows: WINDOWS_OK, macos: MACOS_OK },
  });
  assert.deepEqual(problems, [], 'stable with valid signed+notarized+stapled reports passes');
}

// Stable, Windows report signed but invalid → fails.
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: false,
    manifest: manifest(),
    reports: {
      windows: { ...WINDOWS_OK, verification: 'invalid' },
      macos: MACOS_OK,
    },
  });
  assert.ok(
    problems.some((p) => /verification='invalid'/.test(p)),
    'invalid windows signature fails',
  );
}

// Stable, Windows publisher does not match expectation → fails.
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: false,
    manifest: manifest(),
    reports: {
      windows: { ...WINDOWS_OK, publisher: 'CN=Some Other Company' },
      macos: MACOS_OK,
    },
    expectedPublisher: 'K-Arthur',
  });
  assert.ok(
    problems.some((p) => /verified publisher/.test(p)),
    'publisher mismatch fails',
  );
}

// macOS signed but NOT notarized → fails (signed-but-unnotarized is worse).
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: false,
    manifest: manifest(),
    reports: {
      windows: WINDOWS_OK,
      macos: { ...MACOS_OK, notarized: false },
    },
  });
  assert.ok(
    problems.some((p) => /notarization did not verify/.test(p)),
    'signed but unnotarized macos fails',
  );
}

// macOS notarized but NOT stapled → fails.
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: false,
    manifest: manifest(),
    reports: {
      windows: WINDOWS_OK,
      macos: { ...MACOS_OK, stapled: false },
    },
  });
  assert.ok(
    problems.some((p) => /not stapled/.test(p)),
    'unstapled macos fails',
  );
}

// macOS missing hardened runtime → fails.
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: false,
    manifest: manifest(),
    reports: {
      windows: WINDOWS_OK,
      macos: { ...MACOS_OK, hardenedRuntime: false },
    },
  });
  assert.ok(
    problems.some((p) => /hardened runtime/.test(p)),
    'missing hardened runtime fails',
  );
}

// ── Mislabelled signedness must fail ────────────────────────────────────────
// Unsigned Windows installer mislabelled signed: manifest says signed, no reports.
{
  const { problems } = verifyReleaseTrust({
    channel: 'prerelease',
    expectSigned: false,
    manifest: manifest({ signed: true }),
    reports: {},
  });
  assert.ok(
    problems.some((p) => /claims signed=true but no platform verification report/.test(p)),
    'signed=true without evidence fails',
  );
}

// Unsigned DMG mislabelled notarized.
{
  const { problems } = verifyReleaseTrust({
    channel: 'prerelease',
    expectSigned: false,
    manifest: manifest({ notarized: true }),
    reports: {
      windows: WINDOWS_OK,
      macos: { ...MACOS_OK, signed: false, notarized: false, stapled: false },
    },
  });
  assert.ok(
    problems.some((p) => /claims notarized=true/.test(p)),
    'notarized=true without evidence fails',
  );
}

// Prerelease with signed-but-unnotarized macOS artifact → fails even though
// signing was optional (a false claim is never allowed).
{
  const { problems } = verifyReleaseTrust({
    channel: 'prerelease',
    expectSigned: false,
    manifest: manifest({ signed: true, notarized: false }),
    reports: {
      windows: WINDOWS_OK,
      macos: { ...MACOS_OK, notarized: false, stapled: false },
    },
  });
  assert.ok(
    problems.some((p) => /notarization did not verify|not stapled/.test(p)),
    'prerelease with false macos claim fails',
  );
}

// Evidence exists but manifest not updated → merge-order bug detection.
{
  const { problems } = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: false,
    manifest: manifest(),
    reports: { windows: WINDOWS_OK, macos: MACOS_OK },
  });
  assert.ok(
    problems.some((p) => /manifest.signed is not true/.test(p)),
    'signed reports with stale manifest fail',
  );
}

// ── Checksum-before-signing ordering detection ──────────────────────────────
// Simulate: checksums generated, THEN signing modifies the bytes. The
// verify-artifacts gate must detect the hash mismatch.
{
  const tmp = join(tmpdir(), `varve-order-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const before = Buffer.from('unsigned-installer-bytes');
  const after = Buffer.from('unsigned-installer-bytes-with-authenticode-signature');
  const filename = 'Varve-0.1.0-windows-x86_64.exe';

  writeFileSync(
    join(tmp, 'release-manifest.json'),
    JSON.stringify({
      version: '0.1.0',
      signed: false,
      notarized: false,
      artifacts: [
        { filename, os: 'windows', format: 'nsis', sizeBytes: after.length, sha256: sha256(after) },
      ],
    }),
  );
  writeFileSync(join(tmp, 'SHA256SUMS.txt'), `${sha256(before)}  ${filename}\n`);
  writeFileSync(join(tmp, filename), after);

  // The checksum was computed from the PRE-signing bytes; the artifact on
  // disk differs → verification must fail with a hash mismatch.
  let failed = false;
  let output = '';
  try {
    output = execFileSync(
      process.execPath,
      ['scripts/release/verify-artifacts.mjs', '--dir', tmp],
      { encoding: 'utf-8' },
    );
  } catch (err) {
    failed = true;
    output = String(err.stdout ?? '') + String(err.stderr ?? '');
  }
  assert.equal(failed, true, 'post-checksum signing must be detected');
  assert.match(output, /Hash mismatch|disagrees|not match/i, 'failure names the hash mismatch');
  rmSync(tmp, { recursive: true, force: true });
}

// ── Report discovery ────────────────────────────────────────────────────────
{
  const tmp = join(tmpdir(), `varve-reports-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'nested'), { recursive: true });
  writeFileSync(join(tmp, 'nested', 'signing-report-windows.json'), JSON.stringify(WINDOWS_OK));
  writeFileSync(join(tmp, 'nested', 'signing-report-macos.json'), JSON.stringify(MACOS_OK));
  writeFileSync(join(tmp, 'nested', 'release-manifest.json'), '{}');

  const found = findSigningReports(tmp);
  assert.deepEqual(found.map((f) => f.platform).sort(), ['macos', 'windows'], 'discovers reports');
  const reports = readSigningReports(tmp);
  assert.equal(reports.windows.signed, true, 'parses report');
  assert.equal(reports.macos.stapled, true, 'parses macos report');

  // A corrupt report must never be treated as signed.
  writeFileSync(join(tmp, 'nested', 'signing-report-windows.json'), '{not json');
  const corrupt = readSigningReports(tmp);
  assert.equal(corrupt.windows.signed, false, 'corrupt report is never signed');
  rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write('signing-policy.test.mjs: all assertions passed\n');

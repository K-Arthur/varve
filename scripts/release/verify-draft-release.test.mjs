#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { load } from 'js-yaml';
import {
  readSigningReports,
  signingStateFromReport,
  verifyReleaseTrust,
} from './signing-policy.mjs';
import { RELEASE_TARGETS } from './targets.mjs';
import {
  draftFingerprint,
  parseArgs,
  requiredTargets,
  verifyChecksumAttestation,
  verifyDraftDirectory,
  verifyDraftRelease,
  verifyRecoveryBuild,
} from './verify-draft-release.mjs';

const options = {
  repository: 'K-Arthur/varve',
  tag: 'v0.5.0',
  commitSha: 'a'.repeat(40),
  policyHash: 'b'.repeat(64),
  platforms: 'all',
  channel: 'stable',
  expectSigned: false,
};
const suffix = { appimage: 'AppImage', deb: 'deb', rpm: 'rpm', nsis: 'exe', dmg: 'dmg' };

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJSON(dir, filename, value) {
  writeFileSync(join(dir, filename), `${JSON.stringify(value)}\n`);
}

function sbom() {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: 'Varve',
        version: '0.5.0',
        'bom-ref': 'pkg:generic/varve@0.5.0',
      },
      properties: [{ name: 'varve:gitCommit', value: options.commitSha }],
    },
    components: [
      {
        type: 'library',
        name: 'fixture',
        version: '1.0.0',
        'bom-ref': 'pkg:npm/fixture@1.0.0',
        purl: 'pkg:npm/fixture@1.0.0',
        licenses: [],
      },
    ],
  };
}

function addInstaller(dir, manifest, target, format) {
  const filename = `Varve-0.5.0-${target.id}.${suffix[format]}`;
  writeFileSync(join(dir, filename), Buffer.alloc(1_000_001, 42));
  const sha256 = digest(join(dir, filename));
  const artifact = {
    filename,
    os: target.os,
    arch: target.architecture,
    format,
    sizeBytes: 1_000_001,
    sha256,
  };
  manifest.artifacts.push(artifact);
  writeJSON(dir, `${filename}.provenance.json`, {
    schema: 1,
    version: '0.5.0',
    commitSha: options.commitSha,
    policyHash: options.policyHash,
    platform: target.id,
    artifact: filename,
    sha256,
  });
  if (target.os === 'windows') {
    writeJSON(dir, `installer-size-report-${target.id}.json`, {
      schemaVersion: 1,
      installers: [{ filename, sizeBytes: artifact.sizeBytes, status: 'ok' }],
    });
    writeJSON(dir, `signing-report-${target.id}.json`, {
      platform: 'windows',
      artifact: filename,
      signed: false,
      verification: 'not-signed',
      files: [{ filename, status: 'NotSigned' }],
      checkedAt:
        target.architecture === 'aarch64' ? '2026-10-02T00:01:00Z' : '2026-10-02T00:00:00Z',
    });
  }
}

function refresh(fixture) {
  writeJSON(fixture.dir, 'release-manifest.json', fixture.manifest);
  const files = readdirSync(fixture.dir)
    .filter((name) => name !== 'SHA256SUMS.txt')
    .sort();
  writeFileSync(
    join(fixture.dir, 'SHA256SUMS.txt'),
    `${files.map((name) => `${digest(join(fixture.dir, name))}  ${name}`).join('\n')}\n`,
  );
  fixture.release = {
    id: 77,
    tag_name: options.tag,
    draft: true,
    prerelease: false,
    published_at: null,
    assets: readdirSync(fixture.dir)
      .sort()
      .map((name, i) => ({
        id: i + 1,
        name,
        size: statSync(join(fixture.dir, name)).size,
        state: 'uploaded',
        digest: `sha256:${digest(join(fixture.dir, name))}`,
        updated_at: '2026-10-02T00:00:00Z',
      })),
  };
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'varve-draft-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manifest = {
    version: '0.5.0',
    signed: false,
    notarized: false,
    signing: {},
    artifacts: [],
  };
  for (const target of RELEASE_TARGETS)
    for (const format of target.packageFormats) addInstaller(dir, manifest, target, format);
  for (const platform of ['macos']) {
    const report = { platform, signed: false, checkedAt: '2026-10-02T00:00:00Z' };
    writeJSON(dir, `signing-report-${platform}.json`, report);
    manifest.signing[platform] = signingStateFromReport({ platform, report });
  }
  manifest.signing.windows = signingStateFromReport({
    platform: 'windows',
    report: readSigningReports(dir).windows,
  });
  writeJSON(dir, 'varve-0.5.0-sbom.cdx.json', sbom());
  const value = { dir, manifest };
  refresh(value);
  return value;
}

function attestation(path, commitSha = options.commitSha, recovery) {
  return [
    {
      verificationResult: {
        signature: {
          certificate: {
            issuer: 'https://token.actions.githubusercontent.com',
            sourceRepositoryURI: `https://github.com/${options.repository}`,
            sourceRepositoryDigest: commitSha,
            buildSignerURI: `https://github.com/${options.repository}/.github/workflows/release.yml@refs/tags/v0.5.0`,
            ...(recovery
              ? {
                  buildSignerURI: `https://github.com/${options.repository}/.github/workflows/release.yml@${recovery.signerRef}`,
                  buildSignerDigest: recovery.workflowSha,
                  sourceRepositoryRef: recovery.signerRef,
                  runInvocationURI: recovery.invocation,
                }
              : {}),
          },
        },
        statement: {
          subject: [{ name: 'SHA256SUMS.txt', digest: { sha256: digest(path) } }],
          predicate: { sourceRepositoryDigest: options.commitSha },
        },
      },
    },
  ];
}

function addUpdaterFeed(value, filename = 'varve-update-stable.json') {
  const platforms = {};
  for (const target of RELEASE_TARGETS) {
    const extension =
      target.os === 'linux' ? 'AppImage' : target.os === 'windows' ? 'exe' : 'app.tar.gz';
    const artifact = `Varve-0.5.0-${target.id}.${extension}`;
    if (target.os === 'macos') writeFileSync(join(value.dir, artifact), 'fixture updater bundle');
    writeFileSync(join(value.dir, `${artifact}.sig`), 'invalid\n');
    const key = target.os === 'macos' ? 'darwin-aarch64' : target.id;
    platforms[key] = {
      url: `https://github.com/${options.repository}/releases/download/${options.tag}/${artifact}`,
      signature: 'invalid',
    };
  }
  const feed = { version: '0.5.0', platforms };
  writeJSON(value.dir, filename, feed);
  refresh(value);
  return feed;
}

function runner(
  value,
  { attestationSha, mutateSecondRead, recoveryRun, mutateSecondRun, compare } = {},
) {
  const calls = [];
  let reads = 0;
  let buildReads = 0;
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command !== 'gh')
      return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (args[0] === 'api') {
      if (args[1].endsWith('/branches/master'))
        return JSON.stringify({
          name: 'master',
          commit: { sha: recoveryOptions.trustedWorkflowSha },
        });
      if (args[1].includes('/actions/runs/')) {
        buildReads += 1;
        const build = structuredClone(recoveryRun);
        if (buildReads === 2 && mutateSecondRun) mutateSecondRun(build);
        return JSON.stringify(build);
      }
      if (args[1].includes('/compare/')) {
        const base = args[1].split('/compare/')[1].split('...')[0];
        return JSON.stringify(
          compare ?? {
            status: 'ahead',
            base_commit: { sha: base },
            merge_base_commit: { sha: base },
          },
        );
      }
      reads += 1;
      const release = structuredClone(value.release);
      if (reads === 2 && mutateSecondRead) mutateSecondRead(release);
      return JSON.stringify(release);
    }
    if (args[0] === 'release' && args[1] === 'download') {
      cpSync(value.dir, args[args.indexOf('--dir') + 1], { recursive: true });
      return '';
    }
    if (args[0] === 'attestation' && args[1] === 'verify')
      return JSON.stringify(
        attestation(
          args[2],
          attestationSha,
          recoveryRun ? verifyRecoveryBuild(recoveryRun, recoveryOptions) : undefined,
        ),
      );
    throw new Error('Unexpected GitHub mutation or command');
  };
  return { run, calls };
}

test('actual complete draft passes existing byte, provenance, SBOM and signing validators', (t) => {
  const value = fixture(t);
  assert.equal(verifyDraftDirectory(value.dir, value.release, options).installers, 9);
});

const recoveryOptions = {
  ...options,
  buildRunId: '88',
  trustedWorkflowSha: 'd'.repeat(40),
};
function recoveryBuild() {
  return {
    id: 88,
    head_sha: 'c'.repeat(40),
    head_branch: 'master',
    head_repository: { full_name: options.repository },
    path: '.github/workflows/release.yml',
    event: 'workflow_dispatch',
    html_url: `https://github.com/${options.repository}/actions/runs/88`,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
  };
}

test('recovery authenticates an explicit successful master build and retains exact tag provenance', (t) => {
  const value = fixture(t);
  const fake = runner(value, { recoveryRun: recoveryBuild(), attestationSha: 'c'.repeat(40) });
  const result = verifyDraftRelease(recoveryOptions, fake.run);
  t.after(() => rmSync(result.dir, { recursive: true, force: true }));
  assert.equal(result.commitSha, options.commitSha);
  assert.equal(result.installers, 9);
  assert.equal(fake.calls.filter((call) => call[2]?.includes('/actions/runs/88')).length, 2);
  assert.equal(fake.calls.filter((call) => call[2]?.includes('/compare/')).length, 6);
});

test('recovery refuses failed, pending, foreign, branch and mismatched run identities', () => {
  for (const change of [
    { id: 89 },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'other/repo' } },
    { path: '.github/workflows/ci.yml' },
    { event: 'pull_request' },
    { head_sha: '' },
    { html_url: 'https://example.com/run' },
    { run_attempt: 0 },
    { status: 'in_progress' },
    { conclusion: 'failure' },
  ]) {
    assert.throws(
      () => verifyRecoveryBuild({ ...recoveryBuild(), ...change }, recoveryOptions),
      /exact successful master Release run/,
    );
  }
});

test('recovery rejects diverged ancestry before downloading any release bytes', (t) => {
  const value = fixture(t);
  for (const comparison of [
    { status: 'diverged' },
    { status: 'behind' },
    {
      status: 'ahead',
      base_commit: { sha: options.commitSha },
      merge_base_commit: { sha: 'e'.repeat(40) },
    },
  ]) {
    const fake = runner(value, { recoveryRun: recoveryBuild(), compare: comparison });
    assert.throws(() => verifyDraftRelease(recoveryOptions, fake.run), /accepted master ancestry/);
    assert.ok(!fake.calls.some((call) => call.includes('download')));
  }
});

test('recovery certificate must bind the exact workflow digest, master ref and run attempt', (t) => {
  const value = fixture(t);
  const path = join(value.dir, 'SHA256SUMS.txt');
  const recovery = verifyRecoveryBuild(recoveryBuild(), recoveryOptions);
  const proof = attestation(path, recovery.workflowSha, recovery);
  assert.doesNotThrow(() =>
    verifyChecksumAttestation(proof, { ...options, checksumsPath: path, recovery }),
  );
  for (const key of [
    'issuer',
    'sourceRepositoryURI',
    'sourceRepositoryDigest',
    'buildSignerURI',
    'buildSignerDigest',
    'sourceRepositoryRef',
    'runInvocationURI',
  ]) {
    const invalid = structuredClone(proof);
    invalid[0].verificationResult.signature.certificate[key] = 'forged';
    assert.throws(
      () => verifyChecksumAttestation(invalid, { ...options, checksumsPath: path, recovery }),
      /requested exact source SHA/,
    );
  }
});

test('recovery stops if a newer build attempt appears during verification', (t) => {
  const value = fixture(t);
  const dir = `${value.dir}-download`;
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = runner(value, {
    recoveryRun: recoveryBuild(),
    attestationSha: 'c'.repeat(40),
    mutateSecondRun: (build) => {
      build.run_attempt = 2;
    },
  });
  assert.throws(
    () => verifyDraftRelease({ ...recoveryOptions, dir }, fake.run),
    /Recovery build attempt changed/,
  );
});

test('recovery input errors stop before GitHub execution', () => {
  for (const change of [
    { buildRunId: '0' },
    { buildRunId: '9007199254740992' },
    { trustedWorkflowSha: undefined },
    { buildRunId: undefined },
  ]) {
    assert.throws(
      () =>
        verifyDraftRelease({ ...recoveryOptions, ...change }, () => assert.fail('GitHub called')),
      /recovery build run ID|trusted publication workflow SHA/,
    );
  }
});

test('only read-only GitHub operations are used and assets are rechecked before returning', (t) => {
  const value = fixture(t);
  const fake = runner(value);
  const dir = join(value.dir, '..', `${basename(value.dir)}-download`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = verifyDraftRelease({ ...options, dir }, fake.run);
  assert.equal(result.installers, 9);
  assert.equal(fake.calls.filter((call) => call[0] === 'gh' && call[1] === 'api').length, 2);
  assert.ok(fake.calls.some((call) => call.includes('--signer-workflow')));
  assert.ok(fake.calls.every((call) => !call.includes('edit') && !call.includes('POST')));
});

test('requested platforms preserve explicit partial rehearsal selections', () => {
  assert.equal(requiredTargets('linux').length, 2);
  assert.equal(requiredTargets('linux-windows').length, 4);
  assert.equal(requiredTargets('all').length, 5);
  assert.throws(() => requiredTargets('unknown'), /Invalid platform/);
});

test('CLI rejects unknown, duplicated, dangling and unpaired options before any GitHub operation', () => {
  for (const argv of [
    ['--unknown', 'value'],
    ['repo', 'K-Arthur/varve'],
    ['--tag'],
    ['--tag', '--sha', options.commitSha],
    ['--tag', 'v0.5.0', '--tag', 'v0.2.1'],
  ]) {
    assert.throws(() => parseArgs(argv), /Unknown|Missing value|Duplicate/);
  }
  assert.deepEqual(parseArgs(['--expect-signed', 'true', '--require-updater', 'false']), {
    'expect-signed': 'true',
    'require-updater': 'false',
  });
});

test('malformed boolean policy inputs cannot silently downgrade signing or updater requirements', () => {
  for (const flag of ['--expect-signed', '--require-updater']) {
    for (const value of ['TRUE', 'FALSE', 'yes', '1', '0', ''])
      assert.throws(() => parseArgs([flag, value]), /exactly true or false|Missing value/);
  }
});

test('missing required package format fails even with consistent hashes', (t) => {
  const value = fixture(t);
  value.manifest.artifacts = value.manifest.artifacts.filter(
    (artifact) => artifact.format !== 'rpm',
  );
  for (const name of readdirSync(value.dir).filter((name) => name.includes('.rpm')))
    rmSync(join(value.dir, name));
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /Missing required linux-x86_64 rpm/,
  );
});

test('missing requested architecture fails even with a self-consistent partial set', (t) => {
  const value = fixture(t);
  value.manifest.artifacts = value.manifest.artifacts.filter(
    (artifact) => !(artifact.os === 'windows' && artifact.arch === 'aarch64'),
  );
  for (const name of readdirSync(value.dir).filter((name) => name.includes('windows-aarch64')))
    rmSync(join(value.dir, name));
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /Missing required windows-aarch64 nsis/,
  );
});

test('rehashed provenance from another source SHA or candidate policy fails', (t) => {
  const value = fixture(t);
  const name = `${value.manifest.artifacts[0].filename}.provenance.json`;
  const metadata = JSON.parse(readFileSync(join(value.dir, name), 'utf8'));
  writeJSON(value.dir, name, {
    ...metadata,
    commitSha: 'c'.repeat(40),
    policyHash: 'd'.repeat(64),
  });
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /commitSha mismatch, policyHash mismatch/,
  );
});

test('absent installer provenance fails instead of trusting a matching manifest', (t) => {
  const value = fixture(t);
  rmSync(join(value.dir, `${value.manifest.artifacts[0].filename}.provenance.json`));
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /installer and provenance sets differ/,
  );
});

test('changed bytes fail the existing downloaded-byte verifier', (t) => {
  const value = fixture(t);
  writeFileSync(join(value.dir, value.manifest.artifacts[0].filename), Buffer.alloc(1_000_001, 43));
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /verify-downloaded.mjs failed/,
  );
});

test('checksum authentication checks the trusted certificate, not a forged predicate', (t) => {
  const value = fixture(t);
  const path = join(value.dir, 'SHA256SUMS.txt');
  assert.doesNotThrow(() =>
    verifyChecksumAttestation(attestation(path), { ...options, checksumsPath: path }),
  );
  assert.throws(
    () =>
      verifyChecksumAttestation(attestation(path, 'c'.repeat(40)), {
        ...options,
        checksumsPath: path,
      }),
    /requested exact source SHA/,
  );
  const proof = attestation(path);
  delete proof[0].verificationResult.signature.certificate.sourceRepositoryDigest;
  assert.throws(
    () => verifyChecksumAttestation(proof, { ...options, checksumsPath: path }),
    /requested exact source SHA/,
  );
});

test('a verified attestation for other checksum bytes fails', (t) => {
  const value = fixture(t);
  const path = join(value.dir, 'SHA256SUMS.txt');
  const proof = attestation(path);
  writeFileSync(path, `${readFileSync(path, 'utf8')}\n`);
  assert.throws(
    () => verifyChecksumAttestation(proof, { ...options, checksumsPath: path }),
    /requested exact source SHA/,
  );
});

test('expected platform signing fails closed while unsigned labels remain permitted by default', (t) => {
  const value = fixture(t);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, { ...options, expectSigned: true }),
    /signing required/,
  );
});

test('per-platform signing labels cannot contradict authenticated reports', (t) => {
  const value = fixture(t);
  value.manifest.signing.windows.signed = true;
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /signing labels do not match/,
  );
});

test('both Windows report files survive flattening and aggregate into the manifest', (t) => {
  const value = fixture(t);
  const reports = readSigningReports(value.dir);
  assert.deepEqual(Object.keys(reports.windows.architectureReports).sort(), ['aarch64', 'x86_64']);
  assert.deepEqual(
    value.manifest.signing.windows.files.sort(),
    value.manifest.artifacts
      .filter((artifact) => artifact.os === 'windows')
      .map((artifact) => artifact.filename)
      .sort(),
  );
  assert.equal(value.manifest.signing.windows.verifiedAt, '2026-10-02T00:01:00Z');
});

test('the real multi-platform trust merger derives the same labels from both retained reports', (t) => {
  const value = fixture(t);
  const staged = `${value.dir}-staged`;
  const out = `${value.dir}-out`;
  t.after(() => {
    rmSync(staged, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
  cpSync(value.dir, out, { recursive: true });
  for (const target of RELEASE_TARGETS) {
    const dir = join(staged, target.id);
    mkdirSync(dir, { recursive: true });
    writeJSON(dir, 'release-manifest.json', {
      version: '0.5.0',
      artifacts: value.manifest.artifacts.filter(
        (artifact) => artifact.os === target.os && artifact.arch === target.architecture,
      ),
    });
    const name =
      target.os === 'windows' ? `signing-report-${target.id}.json` : 'signing-report-macos.json';
    if (target.os !== 'linux') cpSync(join(value.dir, name), join(dir, name));
  }
  execFileSync(
    process.execPath,
    [
      'scripts/release/verify-release-trust.mjs',
      '--staged',
      staged,
      '--out',
      out,
      '--channel',
      'stable',
      '--expect-signed',
      'false',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const manifest = JSON.parse(readFileSync(join(out, 'release-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.signing.windows, value.manifest.signing.windows);
  assert.equal(manifest.artifacts.length, 9);
});

test('legacy Windows BOM reports parse without replacing real evidence with an error report', (t) => {
  const value = fixture(t);
  const name = 'signing-report-windows-aarch64.json';
  writeFileSync(join(value.dir, name), `\uFEFF${readFileSync(join(value.dir, name), 'utf8')}`);
  refresh(value);
  assert.equal(readSigningReports(value.dir).windows.files.length, 2);
  assert.doesNotThrow(() => verifyDraftDirectory(value.dir, value.release, options));
});

test('missing Windows architecture evidence fails even when aggregate labels are regenerated', (t) => {
  const value = fixture(t);
  rmSync(join(value.dir, 'signing-report-windows-aarch64.json'));
  value.manifest.signing.windows = signingStateFromReport({
    platform: 'windows',
    report: readSigningReports(value.dir).windows,
  });
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /missing matching architecture signing evidence/,
  );
});

test('architecture reports must verify their own installer rather than another architecture', (t) => {
  const value = fixture(t);
  const name = 'signing-report-windows-aarch64.json';
  const report = JSON.parse(readFileSync(join(value.dir, name), 'utf8'));
  report.files[0].filename = 'Varve-0.5.0-windows-x86_64.exe';
  writeJSON(value.dir, name, report);
  value.manifest.signing.windows = signingStateFromReport({
    platform: 'windows',
    report: readSigningReports(value.dir).windows,
  });
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /missing matching architecture signing evidence/,
  );
});

test('opportunistic signing cannot silently downgrade one Windows architecture', (t) => {
  const value = fixture(t);
  const name = 'signing-report-windows-aarch64.json';
  const report = JSON.parse(readFileSync(join(value.dir, name), 'utf8'));
  writeJSON(value.dir, name, {
    ...report,
    signed: true,
    verification: 'valid',
    publisher: 'CN=Varve',
  });
  assert.throws(() => readSigningReports(value.dir), /disagree about signedness/);
});

test('expected Windows signing verifies both architectures and preserves actual file evidence', (t) => {
  const value = fixture(t);
  for (const name of [
    'signing-report-windows-aarch64.json',
    'signing-report-windows-x86_64.json',
  ]) {
    const report = JSON.parse(readFileSync(join(value.dir, name), 'utf8'));
    writeJSON(value.dir, name, {
      ...report,
      signed: true,
      verification: 'valid',
      publisher: 'CN=Varve',
      timestamped: true,
    });
  }
  const reports = readSigningReports(value.dir);
  const result = verifyReleaseTrust({
    channel: 'stable',
    expectSigned: true,
    manifest: {
      signed: true,
      artifacts: value.manifest.artifacts.filter((artifact) => artifact.os === 'windows'),
    },
    reports,
  });
  assert.deepEqual(result.problems, []);
  assert.equal(
    signingStateFromReport({ platform: 'windows', report: reports.windows }).files.length,
    2,
  );
});

test('corrupt native reports are hard errors and the producer uses BOM-free UTF-8', (t) => {
  const value = fixture(t);
  writeFileSync(join(value.dir, 'signing-report-windows-aarch64.json'), '{broken');
  assert.throws(() => readSigningReports(value.dir), /Unreadable signing report/);
  const producer = readFileSync('scripts/release/verify-windows-signature.ps1', 'utf8');
  assert.match(producer, /UTF8Encoding\(\$false\)/);
  assert.match(producer, /WriteAllText/);
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /signing-report-windows-\$\{\{ matrix\.arch_slug \}\}\.json/);
});

test('SBOM source or version drift fails even with regenerated matching checksums', (t) => {
  const value = fixture(t);
  const report = sbom();
  report.metadata.component.version = '0.2.1';
  writeJSON(value.dir, 'varve-0.5.0-sbom.cdx.json', report);
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /SBOM version or source SHA mismatch/,
  );
});

test('blocked installer-size evidence cannot be bypassed at publication', (t) => {
  const value = fixture(t);
  const name = 'installer-size-report-windows-aarch64.json';
  const report = JSON.parse(readFileSync(join(value.dir, name), 'utf8'));
  report.installers[0].status = 'block';
  writeJSON(value.dir, name, report);
  refresh(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /unsuccessful installer-size evidence/,
  );
});

test('an updater feed is verified cryptographically again instead of only trusting its checksum', (t) => {
  const value = fixture(t);
  addUpdaterFeed(value);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /verify-updater-feed-signatures.mjs failed/,
  );
});

test('four platform entries cannot pass while the macOS updater target is missing', (t) => {
  const value = fixture(t);
  const feed = addUpdaterFeed(value);
  delete feed.platforms['darwin-aarch64'];
  writeJSON(value.dir, 'varve-update-stable.json', feed);
  refresh(value);
  let cryptoCalls = 0;
  const run = (command, args) => {
    if (args[0].endsWith('verify-updater-feed-signatures.mjs')) {
      cryptoCalls += 1;
      return '';
    }
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options, run),
    /does not cover every requested\/present installer target/,
  );
  assert.equal(
    cryptoCalls,
    0,
    'coverage rejects before trusting otherwise valid signature results',
  );
});

test('a key-backed release requires its updater feed while manual-only policy remains available', (t) => {
  const value = fixture(t);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, { ...options, requireUpdater: true }),
    /Required signed updater feed is missing/,
  );
  assert.doesNotThrow(() =>
    verifyDraftDirectory(value.dir, value.release, { ...options, requireUpdater: false }),
  );
});

test('updater channel and artifact mapping must match the requested release', (t) => {
  const value = fixture(t);
  addUpdaterFeed(value, 'varve-update-beta.json');
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /channel must match varve-update-stable.json/,
  );
});

test('published releases, unsafe assets and unfinished uploads are rejected before downloading', (t) => {
  const value = fixture(t);
  assert.throws(
    () => draftFingerprint({ ...value.release, draft: false }, options.tag),
    /unpublished draft/,
  );
  assert.throws(
    () =>
      draftFingerprint(
        { ...value.release, assets: [{ ...value.release.assets[0], name: '../escape' }] },
        options.tag,
      ),
    /Unsafe or duplicate/,
  );
  assert.throws(
    () =>
      draftFingerprint(
        { ...value.release, assets: [{ ...value.release.assets[0], state: 'new' }] },
        options.tag,
      ),
    /incomplete/,
  );
});

test('stale download directories and symbolic-link assets fail closed', (t) => {
  const value = fixture(t);
  assert.throws(
    () => verifyDraftRelease({ ...options, dir: value.dir }, runner(value).run),
    /EEXIST/,
  );
  const path = join(value.dir, value.manifest.artifacts[0].filename);
  const backup = join(tmpdir(), `${basename(value.dir)}-artifact`);
  writeFileSync(backup, readFileSync(path));
  t.after(() => rmSync(backup, { force: true }));
  rmSync(path);
  symlinkSync(backup, path);
  assert.throws(
    () => verifyDraftDirectory(value.dir, value.release, options),
    /complete regular file/,
  );
});

test('changed asset inventory during verification requires a new verification run', (t) => {
  const value = fixture(t);
  const fake = runner(value, {
    mutateSecondRead: (release) => {
      release.assets[0].updated_at = '2026-10-02T00:01:00Z';
    },
  });
  const dir = join(value.dir, '..', `${basename(value.dir)}-download`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(
    () => verifyDraftRelease({ ...options, dir }, fake.run),
    /inventory changed during verification/,
  );
});

test('publish-only workflow verifies actual assets before changing draft=false', () => {
  const text = readFileSync('.github/workflows/release.yml', 'utf8');
  const workflow = text.split('\n  publish:\n')[1];
  assert.ok(workflow);
  const doc = load(text);
  const verifySteps = doc.jobs.verify.steps;
  const selection = verifySteps.findIndex((step) => step.id === 'artifacts');
  const download = verifySteps.findIndex((step) =>
    step.uses?.startsWith('actions/download-artifact@'),
  );
  assert.ok(
    selection >= 0 && download > selection,
    'producer verification precedes artifact download',
  );
  assert.equal(
    verifySteps[download].with['artifact-ids'],
    '$' + '{{ steps.artifacts.outputs.artifact_ids }}',
  );
  assert.equal(
    verifySteps[download].with.pattern,
    undefined,
    'unverified wildcard selection is forbidden',
  );
  assert.match(
    text,
    /group: release-\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref_name \}\}/,
  );
  assert.match(workflow, /attestations: read/);
  assert.equal(doc.jobs.publish.permissions.actions, 'read');
  const publication = doc.jobs.publish.steps;
  const tooling = publication.find(
    (step) => step.name === 'Checkout workflow-pinned publication tooling',
  );
  assert.equal(tooling.with.ref, '$' + '{{ github.workflow_sha }}');
  assert.equal(tooling.with.path, 'release-tooling');
  assert.equal(tooling.with['sparse-checkout'].trim(), '/scripts/release/');
  assert.equal(publication[0].with.ref, '$' + '{{ needs.preflight.outputs.tag }}');
  assert.equal(
    publication[0].with['sparse-checkout'].trim(),
    '/apps/desktop/src-tauri/tauri.conf.json',
  );
  assert.match(workflow, /RECOVERY_BUILD_RUN_ID: \$\{\{ inputs\.build_run_id \}\}/);
  assert.match(
    workflow,
    /--build-run-id "\$RECOVERY_BUILD_RUN_ID" --trusted-workflow-sha "\$TRUSTED_WORKFLOW_SHA"/,
  );
  assert.match(
    workflow,
    /--tauri-conf "\$GITHUB_WORKSPACE\/apps\/desktop\/src-tauri\/tauri\.conf\.json"/,
  );
  assert.ok(workflow.indexOf('verify-draft-release.mjs') < workflow.indexOf('gh release edit'));
  assert.match(workflow, /--sha "\$RELEASE_SHA" --policy-hash "\$RELEASE_POLICY_HASH"/);
  assert.match(workflow, /--platforms "\$RELEASE_PLATFORMS"/);
  assert.match(workflow, /--expect-signed "\$EXPECT_SIGNED"/);
  assert.match(workflow, /--require-updater "\$UPDATER_REQUIRED"/);
  assert.match(workflow, /UPDATER_REQUIRED: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY != '' \}\}/);
  assert.doesNotMatch(workflow, /continue-on-error/);
});

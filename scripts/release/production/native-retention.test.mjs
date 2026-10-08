import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  canonicalEvidencePath,
  nativeRuntimePaths,
  nativeWorkflowContract,
  selectNativeArtifact,
  verifyInstallerSource,
  verifyNativeReports,
  verifyNativeRunnerImage,
} from '../native-qualification-reuse.mjs';
import { nativeReuseInputs } from '../select-run-artifacts.mjs';

const target = 'windows-x86_64';
assert.equal(
  canonicalEvidencePath('D:\\a\\varve\\retained-native\\current-document\\Migrated save β.varve'),
  'D:/a/varve/retained-native/current-document/Migrated save β.varve',
);
assert.equal(
  canonicalEvidencePath('D:\\a\\varve\\retained-platform-source-windows-x86_64.json'),
  'D:/a/varve/retained-platform-source-windows-x86_64.json',
);
assert.deepEqual(nativeReuseInputs({}), { runId: '', targets: [] });
const input = { runId: '37', targets: target, bundleRunId: '37', bundleTargets: [target] };
assert.deepEqual(nativeReuseInputs(input), { runId: '37', targets: [target] });
for (const mutant of [
  { runId: '' },
  { targets: '' },
  { bundleRunId: '38' },
  { bundleTargets: [] },
  { windows: 'false' },
  { targets: target + ',' + target },
])
  assert.throws(() => nativeReuseInputs({ ...input, ...mutant }));
const workflow = readFileSync(
  process.env.VARVE_NATIVE_WORKFLOW_FIXTURE || '.github/workflows/release.yml',
  'utf8',
);
// Original four runtime contracts at 55c539d5; no remote history is needed.
const originalContracts = {
  'linux-x86_64': 'e84a70c1ee9ecd4d4824f3252374cae07df0626a5f5e5dff63fcf5360b801df5',
  'linux-aarch64': '6ed795e3d5f07ad67a105d237b89b7dd39f36da1050066fe264d295defe26a1f',
  'windows-x86_64': 'a13fa2585c6502e5aeeb9df0892dc9ff4befe664b196374180af3a53c5acb1d9',
  'windows-aarch64': '6b4cf10e9fcc335fd2912e710058a3aa542099224a672e69402090b06ac22c6c',
};
const workflowHash = (text, platform) =>
  createHash('sha256')
    .update(JSON.stringify(nativeWorkflowContract(text, platform)))
    .digest('hex');
for (const platform of Object.keys(originalContracts)) {
  assert.equal(
    workflowHash(workflow, platform),
    originalContracts[platform],
    'Retention wiring preserves original native runtime contract',
  );
  assert.notEqual(
    workflowHash(workflow.replace("NODE_VERSION: '26.10.0'", "NODE_VERSION: '26.11.0'"), platform),
    originalContracts[platform],
  );
}
assert.notEqual(
  workflowHash(
    workflow.replace('Installing $($exe.Name) silently', 'Changed installer command'),
    target,
  ),
  originalContracts[target],
);
const paths = [
  'scripts/release/production/macos-production.mjs',
  'scripts/release/production/windows-production.mjs',
  'scripts/release/production/native-pdf.mjs',
  'scripts/release/production/native-pdf.test.mjs',
  'scripts/release/production/new-common-runtime.mjs',
  'pnpm-lock.yaml',
  'tests/e2e/fixtures/published-v021/poster-embedded.varve',
];
assert.deepEqual(
  nativeRuntimePaths(paths, target),
  paths.filter((p) => !p.includes('macos-') && !p.endsWith('.test.mjs')).sort(),
);
assert.ok(nativeRuntimePaths(paths, 'macos-aarch64').includes(paths[0]));
const sha = 'a'.repeat(40),
  name = `native-production-${target}-37-attempt-1`;
const job = {
  id: 11,
  name: 'windows runner smoke',
  run_id: 37,
  head_sha: sha,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  completed_at: new Date().toISOString(),
};
const artifact = {
  id: 21,
  name,
  digest: 'sha256:' + 'b'.repeat(64),
  expired: false,
  size_in_bytes: 100,
  workflow_run: { id: 37, head_sha: sha },
};
const evidence = { runId: 37, runSha: sha, attempt: 2, jobs: [job], artifacts: [artifact] };
assert.equal(selectNativeArtifact(evidence, target).id, 21);
assert.throws(() =>
  selectNativeArtifact(
    { ...evidence, jobs: [{ ...job, completed_at: '2020-01-01T00:00:00Z' }] },
    target,
  ),
);
const runnerLog =
  '2026-10-08Z ##[group]Runner Image\n2026-10-08Z Image: windows-2025-vs2026\n2026-10-08Z Version: 20260925.250.1\n2026-10-08Z ##[endgroup]';
assert.deepEqual(verifyNativeRunnerImage(runnerLog, '20260925.250.1'), {
  image: 'windows-2025-vs2026',
  version: '20260925.250.1',
});
assert.throws(() => verifyNativeRunnerImage(runnerLog, '20261001.1.0'));
assert.throws(() => verifyNativeRunnerImage('', '20260925.250.1'));
assert.throws(() => verifyNativeRunnerImage(runnerLog, undefined));
for (const conclusion of ['failure', 'cancelled', 'skipped', null])
  assert.throws(() =>
    selectNativeArtifact(
      { ...evidence, jobs: [job, { ...job, id: 12, run_attempt: 2, conclusion }] },
      target,
    ),
  );
for (const mutant of [
  { expired: true },
  { digest: null },
  { workflow_run: { id: 38, head_sha: sha } },
])
  assert.throws(() =>
    selectNativeArtifact({ ...evidence, artifacts: [{ ...artifact, ...mutant }] }, target),
  );
assert.throws(() => selectNativeArtifact({ ...evidence, artifacts: [artifact, artifact] }, target));
const dir = mkdtempSync(join(tmpdir(), 'varve-native-retention-'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Execute the actual readers with Windows path construction over real fixture
// files, even on Linux. Reinstating the observed missing normalization fails.
const readerSource = readFileSync(
  new URL('../native-qualification-reuse.mjs', import.meta.url),
  'utf8',
);
function windowsReaders(normalize = true) {
  let code = readerSource.slice(
    readerSource.indexOf('function files('),
    readerSource.indexOf('async function select('),
  );
  code += readerSource.slice(
    readerSource.indexOf('export function verifyInstallerSource('),
    readerSource.indexOf('async function main('),
  );
  code = code.replaceAll('export function', 'function');
  if (!normalize)
    code = code.replace('canonicalEvidencePath(join(dir, entry.name))', 'join(dir, entry.name)');
  const context = {
    assert,
    hash,
    canonicalEvidencePath,
    join: win32.join,
    resolve: win32.resolve,
    readdirSync: (path, options) => readdirSync(canonicalEvidencePath(path), options),
    readFileSync: (path) => readFileSync(canonicalEvidencePath(path)),
    lstatSync: (path) => lstatSync(canonicalEvidencePath(path)),
  };
  vm.runInNewContext(
    `${code}; globalThis.installer = verifyInstallerSource; globalThis.reports = verifyNativeReports;`,
    context,
  );
  return context;
}
try {
  const output = join(dir, 'actual-cli-output');
  const env = {
    ...process.env,
    GITHUB_OUTPUT: output,
    VARVE_NATIVE_REUSE_RUN_ID: '37',
    VARVE_NATIVE_REUSE_TARGETS: target,
    VARVE_REUSE_RUN_ID: '37',
    VARVE_REUSE_TARGETS_JSON: JSON.stringify([target]),
  };
  const selector = fileURLToPath(new URL('../select-run-artifacts.mjs', import.meta.url));
  execFileSync(
    process.execPath,
    [selector, 'native-reuse-inputs', '--windows', 'true', '--macos', 'true'],
    { env, stdio: 'pipe' },
  );
  assert.equal(
    readFileSync(output, 'utf8'),
    `native_reuse_run_id=37\nnative_reuse_targets=["${target}"]\n`,
  );
  writeFileSync(output, '');
  assert.throws(() =>
    execFileSync(process.execPath, [selector, 'native-reuse-inputs'], {
      env: { ...env, VARVE_REUSE_RUN_ID: '38' },
      stdio: 'pipe',
    }),
  );
  assert.equal(
    readFileSync(output, 'utf8'),
    '',
    'Invalid CLI inputs do not emit a partial retention decision',
  );
  const currentDir = join(dir, target, 'current-document'),
    oldDir = join(dir, target, 'old-document');
  mkdirSync(currentDir, { recursive: true });
  mkdirSync(oldDir, { recursive: true });
  const installerDir = join(dir, 'installer');
  const nested = join(installerDir, 'release-windows-x86_64-attempt-1');
  mkdirSync(nested, { recursive: true });
  const selection = {
    target,
    producerRunId: 37,
    producerWorkflowSha: sha,
    bundle: { id: 21, digest: artifact.digest },
  };
  const source = { target, runId: 37, runSha: sha, artifactId: 21, digest: artifact.digest };
  const name = `retained-platform-source-${target}.json`;
  const sourcePath = join(nested, name);
  writeFileSync(sourcePath, JSON.stringify(source));
  verifyInstallerSource(installerDir, selection);
  windowsReaders().installer(installerDir, selection);
  assert.throws(() => windowsReaders(false).installer(installerDir, selection), /One original/);
  for (const mutant of [
    { runId: 38 },
    { runSha: 'c'.repeat(40) },
    { artifactId: 22 },
    { digest: 'sha256:' + 'c'.repeat(64) },
    { target: 'windows-aarch64' },
  ]) {
    writeFileSync(sourcePath, JSON.stringify({ ...source, ...mutant }));
    assert.throws(() => verifyInstallerSource(installerDir, selection));
  }
  writeFileSync(sourcePath, JSON.stringify(source));
  writeFileSync(join(installerDir, name), JSON.stringify(source));
  assert.throws(() => verifyInstallerSource(installerDir, selection), /One original/);
  const saved = JSON.stringify({ formatVersion: '2.33' });
  writeFileSync(join(currentDir, 'Migrated save β.varve'), saved);
  const current = {
    passed: true,
    sourceSha: sha,
    expected: { version: '0.5.0', schema: '2.33' },
    appDataDirectory: 'same/profile',
    evidence: [{ phase: 'native process restart and disk reopen', savedSha256: hash(saved) }],
  };
  for (const format of ['png', 'svg', 'pdf']) {
    const bytes = Buffer.from('actual ' + format);
    writeFileSync(join(currentDir, 'native-export.' + format), bytes);
    current.evidence.push({
      phase: 'actual native ' + format.toUpperCase() + ' output',
      bytes: bytes.length,
      sha256: hash(bytes),
    });
  }
  for (const name of ['native-reopened.png', 'native-export-pdf-render.png'])
    writeFileSync(join(currentDir, name), 'capture');
  const old = {
    passed: true,
    baselineTag: 'v0.2.1',
    expected: { version: '0.2.1', schema: '2.21' },
    appDataDirectory: 'same/profile',
  };
  writeFileSync(join(oldDir, 'qualification.json'), JSON.stringify(old));
  const currentPath = join(currentDir, 'qualification.json');
  writeFileSync(currentPath, JSON.stringify(current));
  assert.ok(verifyNativeReports(dir, { sourceSha: sha, version: '0.5.0' }).currentReportSha256);
  assert.ok(
    windowsReaders().reports(dir, { sourceSha: sha, version: '0.5.0' }).currentReportSha256,
  );
  assert.throws(
    () => windowsReaders(false).reports(dir, { sourceSha: sha, version: '0.5.0' }),
    /One baseline/,
  );
  for (const mutant of [
    { passed: false },
    { sourceSha: 'c'.repeat(40) },
    { appDataDirectory: 'another/profile' },
  ]) {
    writeFileSync(currentPath, JSON.stringify({ ...current, ...mutant }));
    assert.throws(() => verifyNativeReports(dir, { sourceSha: sha, version: '0.5.0' }));
  }
  writeFileSync(currentPath, JSON.stringify(current));
  writeFileSync(join(currentDir, 'native-export.png'), 'corrupt');
  assert.throws(() => verifyNativeReports(dir, { sourceSha: sha, version: '0.5.0' }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(
  'Native retention requires unchanged runtime/runner contracts, latest successful original evidence, same profile and exact export/save bytes; changed, superseded or corrupt evidence fails.',
);

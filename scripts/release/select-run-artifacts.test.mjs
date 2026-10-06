import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import {
  loadReusableRun,
  loadRunArtifacts,
  requestedTargets,
  resolveReuseInputs,
  selectRunArtifacts,
  verifyDownloadedArtifacts,
} from './select-run-artifacts.mjs';

const runId = 37;
const runSha = 'a'.repeat(40);
const tagSha = 'b'.repeat(40);
const policyHash = 'c'.repeat(64);
const linux = 'linux-x86_64';
const windows = 'windows-aarch64';
const workflowSha = 'd'.repeat(40);

test('reuse is opt-in and cannot include a disabled, final or duplicated target', () => {
  assert.deepEqual(resolveReuseInputs({}), { runId: '', targets: [] });
  assert.deepEqual(resolveReuseInputs({ runId: '37', targets: linux }), {
    runId: '37',
    targets: [linux],
  });
  for (const value of [
    { runId: '37' },
    { targets: linux },
    { runId: '0', targets: linux },
    { runId: '37', targets: 'final' },
    { runId: '37', targets: `${linux},${linux}` },
    { runId: '37', targets: windows, windows: 'false' },
  ])
    assert.throws(() => resolveReuseInputs(value));
});

function reusableRun() {
  return {
    id: runId,
    head_sha: runSha,
    run_attempt: 2,
    head_branch: 'master',
    head_repository: { full_name: 'owner/repo' },
    path: '.github/workflows/release.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'failure',
  };
}
function reuseRequest({ change = {}, compare, master } = {}) {
  return async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
    const base = url.split('/compare/')[1]?.split('...')[0];
    const data = base
      ? (compare ?? {
          status: 'ahead',
          base_commit: { sha: base },
          merge_base_commit: { sha: base },
        })
      : url.endsWith('/branches/master')
        ? (master ?? { name: 'master', commit: { sha: workflowSha } })
        : { ...reusableRun(), ...change };
    return { ok: true, json: async () => data };
  };
}
const reuseOptions = {
  repository: 'owner/repo',
  runId,
  workflowSha,
  sourceSha: tagSha,
  token: 'fixture-secret',
};

test('a failed overall run may retain its successful cells only after accepted source binding', async () => {
  assert.deepEqual(await loadReusableRun({ ...reuseOptions, request: reuseRequest() }), {
    runId,
    runSha,
    attempt: 2,
  });
  // Selection still refuses the failed cell; no old-success fallback is added.
  assert.throws(
    () => selectRunArtifacts(evidence({ jobs: [job(linux, 2, 'failure')] })),
    /not uniquely successful/,
  );
});

test('reuse refuses foreign, active, cancelled and incorrect workflow identities', async () => {
  for (const change of [
    { id: 38 },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'other/repo' } },
    { path: '.github/workflows/ci.yml' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'cancelled' },
    { run_attempt: 0 },
    { head_sha: '' },
  ])
    await assert.rejects(
      loadReusableRun({ ...reuseOptions, request: reuseRequest({ change }) }),
      /completed master Release dispatch/,
    );
});

test('reuse refuses diverged or unverifiable product/build/publication ancestry and API failures', async () => {
  for (const compare of [
    { status: 'diverged' },
    { status: 'behind' },
    { status: 'ahead', base_commit: { sha: tagSha }, merge_base_commit: { sha: runSha } },
  ])
    await assert.rejects(
      loadReusableRun({ ...reuseOptions, request: reuseRequest({ compare }) }),
      /accepted master ancestry/,
    );
  await assert.rejects(
    loadReusableRun({ ...reuseOptions, request: reuseRequest({ master: {} }) }),
    /accepted master source/,
  );
  await assert.rejects(
    loadReusableRun({ ...reuseOptions, request: async () => ({ ok: false, status: 403 }) }),
    /^Error: Reuse evidence API returned HTTP 403$/,
  );
});

function job(target, attempt, conclusion = 'success') {
  return {
    name: target === 'final' ? 'Verify, attest and finalize' : `Bundle (${target})`,
    run_id: runId,
    head_sha: runSha,
    run_attempt: attempt,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
  };
}
function artifact(target, attempt, id = attempt * 10) {
  return {
    id,
    name: `release-${target}-attempt-${attempt}`,
    expired: false,
    workflow_run: { id: runId, head_sha: runSha },
  };
}
function evidence(overrides = {}) {
  return {
    artifacts: [artifact(linux, 1)],
    jobs: [job(linux, 1)],
    runId,
    runSha,
    attempt: 2,
    targets: [linux],
    ...overrides,
  };
}

test('a partial matrix rerun selects fresh platform bytes and untouched successful producers', () => {
  const selected = selectRunArtifacts(
    evidence({
      targets: [linux, windows],
      artifacts: [artifact(linux, 1), artifact(linux, 2), artifact(windows, 1, 99)],
      jobs: [job(linux, 1), job(linux, 2), job(windows, 1)],
    }),
  );
  assert.deepEqual(
    selected.map((item) => [item.id, item.attempt]),
    [
      [20, 2],
      [99, 1],
    ],
  );
});

test('whole reruns and final retries select only the newest producer attempt', () => {
  const selected = selectRunArtifacts(
    evidence({
      targets: [linux, windows],
      artifacts: [
        artifact(linux, 1),
        artifact(linux, 2),
        artifact(windows, 1, 90),
        artifact(windows, 2, 91),
      ],
      jobs: [job(linux, 1), job(linux, 2), job(windows, 1), job(windows, 2)],
    }),
  );
  assert.deepEqual(
    selected.map((item) => item.id),
    [20, 91],
  );
  assert.equal(
    selectRunArtifacts(
      evidence({
        targets: ['final'],
        artifacts: [artifact('final', 1), artifact('final', 2)],
        jobs: [job('final', 1), job('final', 2)],
      }),
    )[0].id,
    20,
  );
});

test('newer failed, cancelled, running or missing-upload producers never fall back', () => {
  for (const conclusion of ['failure', 'cancelled', null]) {
    assert.throws(
      () => selectRunArtifacts(evidence({ jobs: [job(linux, 1), job(linux, 2, conclusion)] })),
      /not uniquely successful/,
    );
  }
  assert.throws(
    () => selectRunArtifacts(evidence({ jobs: [job(linux, 1), job(linux, 2)] })),
    /exactly one.*attempt-2/,
  );
});

test('cross-run, source mismatches and future producer attempts are rejected', () => {
  for (const wrong of [{ run_id: 38 }, { head_sha: tagSha }, { run_attempt: 3 }]) {
    assert.throws(
      () => selectRunArtifacts(evidence({ jobs: [{ ...job(linux, 1), ...wrong }] })),
      /identity or attempt mismatch/,
    );
  }
  for (const wrong of [{ id: 38 }, { head_sha: tagSha }]) {
    assert.throws(
      () =>
        selectRunArtifacts(
          evidence({
            artifacts: [
              { ...artifact(linux, 1), workflow_run: { id: runId, head_sha: runSha, ...wrong } },
            ],
          }),
        ),
      /Artifact identity/,
    );
  }
  assert.throws(
    () =>
      selectRunArtifacts(
        evidence({
          artifacts: [artifact(linux, 1), artifact(linux, 3)],
        }),
      ),
    /future workflow attempt/,
  );
});

test('run IDs and attempts require canonical decimal integers', () => {
  for (const value of ['2e0', '0x2', '2.0', '02', ' 2 ', 0, -1, 2.5, null, undefined]) {
    assert.throws(
      () => selectRunArtifacts(evidence({ attempt: value })),
      /Invalid workflow attempt/,
    );
    assert.throws(() => selectRunArtifacts(evidence({ runId: value })), /Invalid workflow run ID/);
  }
  assert.equal(selectRunArtifacts(evidence({ attempt: '2', runId: String(runId) }))[0].id, 10);
});

test('duplicate uploads, duplicate producers, expired and unidentified artifacts fail closed', () => {
  assert.throws(
    () => selectRunArtifacts(evidence({ artifacts: [artifact(linux, 1), artifact(linux, 1, 11)] })),
    /exactly one/,
  );
  assert.throws(
    () => selectRunArtifacts(evidence({ jobs: [job(linux, 1), job(linux, 1)] })),
    /not uniquely successful/,
  );
  for (const wrong of [
    { expired: true },
    { expired: undefined },
    { id: 0 },
    { workflow_run: undefined },
  ]) {
    assert.throws(
      () => selectRunArtifacts(evidence({ artifacts: [{ ...artifact(linux, 1), ...wrong }] })),
      /Artifact identity/,
    );
  }
});

test('requested targets keep partial rehearsals explicit and reject ambiguous inputs', () => {
  assert.deepEqual(requestedTargets('all', { windows: 'false', macos: 'false' }), [
    'linux-x86_64',
    'linux-aarch64',
  ]);
  assert.deepEqual(requestedTargets('final'), ['final']);
  for (const value of [undefined, '', 'final,linux-x86_64', `${linux},${linux}`, 'linux']) {
    assert.throws(() => requestedTargets(value), /required/);
  }
  assert.throws(() => requestedTargets('all', { windows: 'yes' }), /true or false/);
});

function downloadedFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'varve-release-attempt-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const staged = join(directory, 'release-linux-x86_64-attempt-2');
  mkdirSync(staged);
  const filename = 'Varve-0.5.0-linux-x86_64.deb';
  const bytes = Buffer.from('verified installer');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(staged, filename), bytes);
  const manifest = {
    version: '0.5.0',
    artifacts: [{ filename, os: 'linux', arch: 'x86_64', sha256 }],
  };
  const provenance = {
    schema: 1,
    version: '0.5.0',
    commitSha: tagSha,
    policyHash,
    platform: linux,
    artifact: filename,
    sha256,
  };
  writeFileSync(join(staged, 'release-manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(staged, `${filename}.provenance.json`), JSON.stringify(provenance));
  return {
    directory,
    staged,
    filename,
    manifest,
    provenance,
    expected: { version: '0.5.0', commitSha: tagSha, policyHash, targets: [linux] },
  };
}

test('downloaded bytes use the immutable tag SHA separately from the workflow head SHA', (t) => {
  const fixture = downloadedFixture(t);
  assert.equal(verifyDownloadedArtifacts(fixture.directory, fixture.expected), 1);
  assert.equal(verifyDownloadedArtifacts(fixture.staged, fixture.expected), 1);
  assert.throws(
    () => verifyDownloadedArtifacts(fixture.directory, { ...fixture.expected, commitSha: runSha }),
    /commitSha mismatch/,
  );
  assert.throws(
    () =>
      verifyDownloadedArtifacts(fixture.directory, {
        ...fixture.expected,
        policyHash: 'd'.repeat(64),
      }),
    /policyHash mismatch/,
  );
  writeFileSync(join(fixture.staged, fixture.filename), 'tampered installer');
  assert.throws(() => verifyDownloadedArtifacts(fixture.directory, fixture.expected), /SHA-256/);
});

test('manifest omissions, extra platforms and duplicate installer sets cannot be merged', (t) => {
  const fixture = downloadedFixture(t);
  assert.throws(
    () =>
      verifyDownloadedArtifacts(fixture.directory, {
        ...fixture.expected,
        targets: [linux, windows],
      }),
    /Missing downloaded/,
  );
  assert.throws(
    () => verifyDownloadedArtifacts(fixture.directory, { ...fixture.expected, targets: [windows] }),
    /Unexpected/,
  );
  writeFileSync(
    join(fixture.staged, 'release-manifest.json'),
    JSON.stringify({
      ...fixture.manifest,
      artifacts: [...fixture.manifest.artifacts, ...fixture.manifest.artifacts],
    }),
  );
  assert.throws(
    () => verifyDownloadedArtifacts(fixture.directory, fixture.expected),
    /sets differ/,
  );
});

test('API evidence binds the exact current attempt, paginates and never reports credential URLs', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
    if (!url.includes('?'))
      return { ok: true, json: async () => ({ id: runId, head_sha: runSha, run_attempt: 2 }) };
    if (url.includes('/jobs?')) {
      assert.ok(url.includes('filter=all'));
      return { ok: true, json: async () => ({ jobs: [job(linux, 1)] }) };
    }
    const artifacts = url.endsWith('page=1')
      ? Array.from({ length: 100 }, () => artifact(linux, 1))
      : [artifact(linux, 2)];
    return { ok: true, json: async () => ({ artifacts }) };
  };
  const result = await loadRunArtifacts({
    repository: 'owner/repo',
    runId,
    runSha,
    attempt: 2,
    token: 'fixture-secret',
    request,
  });
  assert.equal(result.artifacts.length, 101);
  assert.equal(calls.length, 4);
  await assert.rejects(
    loadRunArtifacts({
      repository: 'owner/repo',
      runId,
      runSha,
      attempt: 1,
      token: 'fixture-secret',
      request,
    }),
    /current attempt mismatch/,
  );
  await assert.rejects(
    loadRunArtifacts({
      repository: 'owner/repo',
      runId,
      runSha,
      attempt: 2,
      token: 'fixture-secret',
      request: async () => ({ ok: false, status: 403 }),
    }),
    /^Error: Actions evidence API returned HTTP 403$/,
  );
});

test('the release workflow uploads by attempt and downloads explicit selected IDs', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  for (const name of [
    `release-\${{ matrix.name }}`,
    `debug-binary-\${{ matrix.name }}`,
    'release-final',
  ]) {
    assert.ok(workflow.includes(`name: ${name}-attempt-\${{ github.run_attempt }}`));
  }
  assert.equal(
    (workflow.match(/artifact-ids: \$\{\{ steps\.artifacts\.outputs\.artifact_ids \}\}/g) ?? [])
      .length,
    4,
  );
  assert.doesNotMatch(workflow, /pattern: release-\*-\*/);
  assert.equal((workflow.match(/select-run-artifacts\.mjs verify/g) ?? []).length, 5);
});

test('retained bundles verify explicit IDs and tagged bytes while every fresh build installs rustfmt', () => {
  const workflow = load(readFileSync('.github/workflows/release.yml', 'utf8'));
  const bundle = workflow.jobs.bundle;
  assert.equal(
    bundle.steps.find((step) => step.uses?.startsWith('dtolnay/rust-toolchain')).with.components,
    'rustfmt',
  );
  const upload = bundle.steps.findIndex((step) => step.name === 'Upload release artifacts');
  const check = bundle.steps.findIndex(
    (step) => step.name === 'Recheck retained producer and tagged bytes',
  );
  const download = bundle.steps.find((step) => step.name === 'Download retained platform bytes');
  assert.ok(check > 0 && check < upload);
  assert.equal(download.with['artifact-ids'], '$' + '{{ steps.reuse.outputs.artifact_ids }}');
  assert.match(bundle.steps[check].run, /--expected-artifact-id/);
  assert.match(bundle.steps[check].run, /--policy-hash/);
  assert.ok(
    bundle.steps[check].run.indexOf('select-run-artifacts.mjs verify') <
      bundle.steps[check].run.indexOf('cp -R'),
  );
  for (const step of bundle.steps) {
    if (step.name === 'Upload release artifacts') assert.equal(step.if, 'matrix.enabled');
    else if (
      step.name?.startsWith('Verify Windows Authenticode') ||
      step.name?.startsWith('Verify macOS signature')
    ) {
      assert.doesNotMatch(step.if, /REUSE_PLATFORM/);
      assert.match(step.env.EXPECT_SIGNED, /needs\.signing-preflight\.outputs\./);
      assert.match(step.env.VERIFY_TOOLING, /release-tooling\//);
      assert.match(step.run, /VERIFY_TOOLING.*scripts\/release\/verify-/);
      assert.ok(bundle.steps.indexOf(step) < upload);
    } else assert.match(step.if, /env\.REUSE_PLATFORM [!=]= 'true'/);
  }
  const closure = bundle.steps.find(
    (step) => step.name === 'Checkout workflow-pinned reuse tooling',
  ).with['sparse-checkout'];
  assert.match(closure, /verify-windows-signature\.ps1/);
  assert.match(closure, /verify-macos-signature\.sh/);
  assert.ok(workflow.jobs.verify.needs.includes('package-smoke'));
  assert.ok(workflow.jobs.verify.needs.includes('platform-smoke'));
});

test('CLI recheck rejects a changed reuse artifact and never adopts final trust output', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'varve-reuse-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'request.mjs');
  writeFileSync(
    preload,
    `globalThis.fetch=async(url)=>({ok:true,json:async()=>{
    if(url.includes('/jobs?'))return {jobs:${JSON.stringify([job(linux, 1)])}};
    if(url.includes('/artifacts?'))return {artifacts:${JSON.stringify([artifact(linux, 1)])}};
    if(url.endsWith('/branches/master'))return {name:'master',commit:{sha:'${workflowSha}'}};
    if(url.includes('/compare/')){const base=url.split('/compare/')[1].split('...')[0];return {status:'ahead',base_commit:{sha:base},merge_base_commit:{sha:base}};}
    return ${JSON.stringify(reusableRun())};}});`,
  );
  const selector = join(dir, 'select-run-artifacts.mjs');
  writeFileSync(selector, readFileSync('scripts/release/select-run-artifacts.mjs'));
  writeFileSync(join(dir, 'resume.mjs'), readFileSync('scripts/release/resume.mjs'));
  const argv = [
    '--import',
    pathToFileURL(preload).href,
    selector,
    'select-reuse',
    '--repo',
    'owner/repo',
    '--run-id',
    '37',
    '--sha',
    workflowSha,
    '--source-sha',
    tagSha,
    '--targets',
    linux,
  ];
  const environment = { ...process.env, GITHUB_TOKEN: 'fixture-secret' };
  delete environment.GITHUB_OUTPUT;
  assert.match(
    execFileSync(process.execPath, [...argv, '--expected-artifact-id', '10'], {
      env: environment,
      encoding: 'utf8',
    }),
    /artifact_ids=10/,
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [...argv, '--expected-artifact-id', '11'], {
        env: environment,
        stdio: 'pipe',
      }),
    /Reuse producer changed/,
  );
  const final = [...argv];
  final[final.length - 1] = 'final';
  assert.throws(
    () => execFileSync(process.execPath, final, { env: environment, stdio: 'pipe' }),
    /final trust and attestation must run again/,
  );
});

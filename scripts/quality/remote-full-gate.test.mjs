import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { buildAdoptedCandidateEvidence } from '../release/certification.mjs';
import { verifyCandidateIntegration } from '../release/verify-candidate-integration.mjs';
import {
  aggregateCertification,
  expectedExecutionMatrices,
  REQUIRED_CI_JOBS,
} from './aggregate-ci.mjs';
import { createBrowserInventory } from './browser-inventory.mjs';
import { readCertificationArtifact, readEvidenceZip } from './certification-artifact.mjs';
import { browserLane, collectBrowserEvidence } from './ci-execution-report.mjs';
import {
  githubReader,
  validateAdoptionPlanPair,
  validateFullAggregate,
  validateFullPlan,
  verifyRemoteFullEvidence,
  verifyRemoteIntegrationEvidence,
} from './remote-full-evidence.mjs';
import { REMOTE_FULL_COMPLEMENT, runRemoteFullGate } from './remote-full-gate.mjs';
import {
  CI_CATEGORIES,
  CI_CATEGORY_LANES,
  FULL_BROWSER_SHARDS,
  POLICY_VERSION,
  promisedLanesForCategories,
  sha256,
} from './validation-policy.mjs';

function evidenceZip(entries, { deflate = true, symlink = false } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, document] of entries) {
    const text = Buffer.from(JSON.stringify(document));
    const data = deflate ? deflateRawSync(text) : text;
    const filename = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(text), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(deflate ? 8 : 0, 10);
    header.writeUInt32LE(crc32(text), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(text.length, 24);
    header.writeUInt16LE(filename.length, 28);
    if (symlink) header.writeUInt32LE(0xa0000000, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, filename);
    offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function artifactMetadata(bytes, overrides = {}) {
  return {
    id: 13,
    expired: false,
    expires_at: '2026-11-01T00:00:00Z',
    size_in_bytes: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    ...overrides,
  };
}

const names = ['ci-certification.json'];
const entries = [[names[0], { passed: true }]];

test('stored and deflated bounded JSON certificates decode without writing archive paths', () => {
  for (const deflate of [false, true])
    assert.deepEqual(readEvidenceZip(evidenceZip(entries, { deflate }), names), {
      'ci-certification.json': { passed: true },
    });
});

test('unexpected paths, duplicates, symbolic links and expanded bombs fail closed', () => {
  for (const zip of [
    evidenceZip([['../ci-certification.json', {}]]),
    evidenceZip([['extra.json', {}]]),
    evidenceZip([...entries, ...entries]),
    evidenceZip(entries, { symlink: true }),
    evidenceZip([[names[0], 'x'.repeat(1024 * 1024 + 1)]]),
  ])
    assert.throws(() => readEvidenceZip(zip, names));
});

test('CRC, truncated archive and forged directory failures are not accepted as JSON', () => {
  const bytes = evidenceZip(entries, { deflate: false });
  const central = bytes.readUInt32LE(bytes.length - 6);
  const badCrc = Buffer.from(bytes);
  badCrc.writeUInt32LE(0, central + 16);
  assert.throws(() => readEvidenceZip(badCrc, names), /checksum/);
  assert.throws(() => readEvidenceZip(bytes.subarray(0, -1), names));
  const badDirectory = Buffer.from(bytes);
  badDirectory.writeUInt32LE(0xffffffff, bytes.length - 6);
  assert.throws(() => readEvidenceZip(badDirectory, names));
});

test('malformed artifact JSON fails without exposing credential-bearing parser excerpts', () => {
  const marker = 'signed-storage-url-fixture';
  const bytes = evidenceZip([[names[0], marker]], { deflate: false });
  const start = 30 + Buffer.byteLength(names[0]);
  const end = start + Buffer.byteLength(JSON.stringify(marker));
  const directory = bytes.readUInt32LE(bytes.length - 6);
  bytes[start] = '['.charCodeAt(0);
  const checksum = crc32(bytes.subarray(start, end));
  bytes.writeUInt32LE(checksum, 14);
  bytes.writeUInt32LE(checksum, directory + 16);
  assert.throws(
    () => readEvidenceZip(bytes, names),
    (error) => {
      assert.equal(error.message, 'evidence ZIP JSON is malformed or not valid UTF-8');
      assert.ok(!error.message.includes(marker));
      return true;
    },
  );
});

test('download uses immutable ID, validates SHA256, and never forwards the GitHub token to signed storage', async () => {
  const bytes = evidenceZip(entries);
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return url.startsWith('https://api.github.com/')
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://results.example.invalid/archive?sig=private-fixture' },
        })
      : new Response(bytes);
  };
  const result = await readCertificationArtifact({
    repo: 'owner/repo',
    token: 'secret-fixture',
    artifact: artifactMetadata(bytes),
    names,
    now: Date.parse('2026-10-02T00:00:00Z'),
    fetcher,
  });
  assert.equal(result.artifactId, 13);
  assert.ok(calls[0].url.endsWith('/artifacts/13/zip'));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-fixture');
  assert.equal(calls[1].options.headers, undefined);
  await assert.rejects(
    () =>
      readCertificationArtifact({
        repo: 'owner/repo',
        token: 'secret-fixture',
        artifact: artifactMetadata(bytes, { digest: `sha256:${'0'.repeat(64)}` }),
        names,
        now: Date.parse('2026-10-02T00:00:00Z'),
        fetcher,
      }),
    /digest mismatch/,
  );
});

test('expired or missing digest metadata is rejected before a network request', async () => {
  const bytes = evidenceZip(entries);
  for (const changes of [
    { expired: true },
    { expires_at: '2026-10-01T00:00:00Z' },
    { expires_at: null },
    { digest: null },
  ])
    await assert.rejects(
      () =>
        readCertificationArtifact({
          repo: 'owner/repo',
          token: 'secret-fixture',
          artifact: artifactMetadata(bytes, changes),
          names,
          now: Date.parse('2026-10-02T00:00:00Z'),
          fetcher: () => assert.fail('invalid metadata must never download'),
        }),
      /metadata/,
    );
});

const identity = {
  repo: 'owner/repo',
  token: 'never-store-fixture-token',
  commitSha: 'a'.repeat(40),
  treeSha: 'b'.repeat(40),
  policyHash: 'c'.repeat(64),
};
const timestamp = Date.parse('2026-10-02T00:00:00Z');
function fullPlan(profile) {
  const categories = Object.fromEntries(CI_CATEGORIES.map((name) => [name, true]));
  const plan = {
    schema: 1,
    profile,
    candidateMode: profile === 'candidate' ? 'final' : null,
    commitSha: identity.commitSha,
    treeSha: identity.treeSha,
    baseSha: identity.commitSha,
    policyHash: identity.policyHash,
    policyVersion: POLICY_VERSION,
    files: [],
    fileHash: sha256(''),
    globalImpact: true,
    categories,
    selectedLanes: promisedLanesForCategories(categories, profile),
    deferredLanes: [],
    e2eShardCount: FULL_BROWSER_SHARDS,
    e2eShards: Array.from({ length: FULL_BROWSER_SHARDS }, (_, index) => index + 1),
  };
  plan.planHash = sha256(
    JSON.stringify({
      commitSha: plan.commitSha,
      baseSha: plan.baseSha,
      fileHash: plan.fileHash,
      categories: plan.categories,
      selectedLanes: plan.selectedLanes,
      candidateMode: plan.candidateMode,
      e2eShardCount: plan.e2eShardCount,
      e2eShards: plan.e2eShards,
      policyHash: plan.policyHash,
    }),
  );
  return plan;
}

function fixtureBrowserEvidence(lanes, _cell, plan, index) {
  const required = lanes.filter(browserLane);
  if (!required.length) return null;
  const folder = mkdtempSync(join(tmpdir(), 'varve-remote-browser-evidence-'));
  try {
    const descriptors = required.map((lane, reportIndex) => {
      const path = `${reportIndex}.json`;
      const projects =
        lane === 'website-e2e'
          ? ['custom-domain', 'ghpages', 'touch']
          : lane === 'e2e:visual'
            ? [
                'chromium-visual-1x',
                'chromium-visual-2x',
                'chromium-visual-3x',
                'chromium-visual-gpu',
              ]
            : ['chromium'];
      const allSuites = Array.from(
        { length: lane === 'e2e:all' ? FULL_BROWSER_SHARDS : 1 },
        (_, caseIndex) => ({
          title: `case ${caseIndex}`,
          specs: [
            {
              file: `fixture-${lane.replaceAll(':', '-')}.spec.ts`,
              title: `certified ${lane} ${caseIndex}`,
              id: sha256(`${lane}:${caseIndex}`),
              line: 1,
              tests: projects.map((projectName) => ({
                projectName,
                expectedStatus: 'passed',
                status: 'expected',
                results: [{ retry: 0, status: 'passed', duration: 1, errors: [] }],
              })),
            },
          ],
        }),
      );
      const json = {
        config: {
          workers: 1,
          updateSnapshots: 'none',
          failOnFlakyTests: true,
          argv: ['--trace=retain-on-failure'],
          projects: projects.map((name) => ({ name, retries: 0 })),
        },
        stats: { expected: projects.length, unexpected: 0, flaky: 0, skipped: 0 },
        errors: [],
        suites: allSuites,
      };
      const inventory = createBrowserInventory(json, {
        lane,
        source: plan,
        argv: [
          'pnpm',
          'exec',
          'playwright',
          'test',
          ...(lane === 'website-e2e'
            ? ['--config', 'playwright.website.config.ts']
            : lane === 'e2e:demo-dist'
              ? ['--config', 'playwright.demo-dist.config.mts']
              : []),
          ...projects.map((name) => `--project=${name}`),
        ],
      });
      if (lane === 'e2e:all') {
        json.suites = [allSuites[index]];
        json.config.shard = { current: index + 1, total: FULL_BROWSER_SHARDS };
      }
      writeFileSync(join(folder, path), JSON.stringify(json));
      return {
        lane,
        path,
        inventory,
        ...(lane === 'e2e:demo-dist' ? { executionShard: `1/${FULL_BROWSER_SHARDS}` } : {}),
      };
    });
    return collectBrowserEvidence(descriptors, { root: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function fullAggregate(plan, binding, transformReport = (report) => report) {
  const reports = CI_CATEGORIES.flatMap((category) => {
    const count =
      category === 'e2e' ? FULL_BROWSER_SHARDS : ['rust', 'desktop'].includes(category) ? 3 : 1;
    return Array.from({ length: count }, (_, index) => {
      const executedLanes =
        category === 'e2e' && index > 0
          ? CI_CATEGORY_LANES[category].filter((lane) => lane !== 'e2e:demo-dist')
          : CI_CATEGORY_LANES[category];
      return transformReport({
        schema: 1,
        category,
        profile: plan.profile,
        candidateMode: plan.candidateMode,
        status: 'success',
        source: {
          commitSha: plan.commitSha,
          treeSha: plan.treeSha,
          plannedCommitSha: plan.commitSha,
          planHash: plan.planHash,
          policyHash: plan.policyHash,
        },
        workflow: { repository: identity.repo, runId: binding.runId, runAttempt: 1 },
        matrix: expectedExecutionMatrices(category, plan.profile)?.[index] ?? 'ubuntu-latest',
        shard: category === 'e2e' ? `${index + 1}/${FULL_BROWSER_SHARDS}` : null,
        executedLanes,
        playwright: fixtureBrowserEvidence(executedLanes, `${category}:${index}`, plan, index),
      });
    });
  });
  return aggregateCertification({
    ...plan,
    needs: Object.fromEntries(
      Object.keys(REQUIRED_CI_JOBS).map((name) => [name, { result: 'success' }]),
    ),
    executionReports: reports,
    workflow: { repository: identity.repo, runId: binding.runId, runAttempt: binding.runAttempt },
  });
}

function remoteFixture() {
  const integrationBinding = { runId: 17, runAttempt: 2, runStartedAt: '2026-10-01T23:00:00Z' };
  const candidateBinding = { runId: 18, runAttempt: 3, runStartedAt: '2026-10-01T23:00:00Z' };
  const certificate = { ok: true, integrationBinding, candidateBinding };
  const archive = new Map();
  const artifacts = { integration: [], candidate: [] };
  const plans = { integration: fullPlan('integration'), candidate: fullPlan('candidate') };
  let artifactId = 10;
  const integrationPlanBytes = evidenceZip([['ci-plan.json', plans.integration]]);
  const integrationPlanArtifact = artifactMetadata(integrationPlanBytes, {
    id: artifactId++,
    name: `varve-ci-plan-${integrationBinding.runId}-attempt-1`,
    workflow_run: { id: integrationBinding.runId, head_sha: identity.commitSha },
  });
  archive.set(integrationPlanArtifact.id, integrationPlanBytes);
  artifacts.integration.push(integrationPlanArtifact);
  const integrationAggregate = fullAggregate(plans.integration, integrationBinding);
  const integrationSummaryBytes = evidenceZip([['ci-certification.json', integrationAggregate]]);
  const integrationSummaryArtifact = artifactMetadata(integrationSummaryBytes, {
    id: artifactId++,
    name: 'integration-summary',
    workflow_run: { id: integrationBinding.runId, head_sha: identity.commitSha },
  });
  archive.set(integrationSummaryArtifact.id, integrationSummaryBytes);
  artifacts.integration.push(integrationSummaryArtifact);
  certificate.integrationArtifact = integrationSummaryArtifact;
  const integrationEvidence = {
    ...identity,
    policyVersion: POLICY_VERSION,
    planHash: plans.integration.planHash,
    binding: integrationBinding,
    plan: { artifactId: integrationPlanArtifact.id, digest: integrationPlanArtifact.digest },
    summary: {
      artifactId: integrationSummaryArtifact.id,
      digest: integrationSummaryArtifact.digest,
    },
  };

  const candidatePlanBytes = evidenceZip([['ci-plan.json', plans.candidate]]);
  const candidatePlanArtifact = artifactMetadata(candidatePlanBytes, {
    id: artifactId++,
    name: `varve-candidate-plan-${identity.commitSha}-${candidateBinding.runId}-attempt-1`,
    workflow_run: { id: candidateBinding.runId, head_sha: identity.commitSha },
  });
  archive.set(candidatePlanArtifact.id, candidatePlanBytes);
  artifacts.candidate.push(candidatePlanArtifact);
  const candidateEvidence = buildAdoptedCandidateEvidence({
    plan: plans.candidate,
    integrationEvidence,
    runId: candidateBinding.runId,
    generatedAt: new Date(timestamp).toISOString(),
  });
  const candidateSummaryBytes = evidenceZip([['candidate-certification.json', candidateEvidence]]);
  const candidateSummaryArtifact = artifactMetadata(candidateSummaryBytes, {
    id: artifactId++,
    name: 'candidate-summary',
    workflow_run: { id: candidateBinding.runId, head_sha: identity.commitSha },
  });
  archive.set(candidateSummaryArtifact.id, candidateSummaryBytes);
  artifacts.candidate.push(candidateSummaryArtifact);
  certificate.artifact = candidateSummaryArtifact;
  const runs = {
    integration: [
      {
        id: 17,
        run_attempt: 2,
        path: '.github/workflows/ci.yml',
        head_sha: identity.commitSha,
        status: 'completed',
        conclusion: 'success',
      },
    ],
    candidate: [
      {
        id: 18,
        run_attempt: 3,
        path: '.github/workflows/release-candidate.yml',
        head_sha: identity.commitSha,
        status: 'completed',
        conclusion: 'success',
      },
    ],
  };
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path.endsWith('/git/ref/heads/master')) return { object: { sha: identity.commitSha } };
    if (path.includes('/workflows/ci.yml/runs?')) return { workflow_runs: runs.integration };
    if (path.includes('/workflows/release-candidate.yml/runs?'))
      return { workflow_runs: runs.candidate };
    if (path.includes('/runs/17/artifacts?')) return { artifacts: artifacts.integration };
    if (path.includes('/runs/18/artifacts?')) return { artifacts: artifacts.candidate };
    throw new Error(`unexpected read-only request ${path}`);
  };
  const readArtifact = (options) =>
    readCertificationArtifact({
      ...options,
      fetcher: async (url, config) => {
        if (url.startsWith('https://api.github.com/')) {
          assert.equal(config.redirect, 'manual');
          const id = Number(url.match(/artifacts\/(\d+)\/zip$/)?.[1]);
          return new Response(null, {
            status: 302,
            headers: { location: `https://results.example.invalid/${id}?sig=never-log-fixture` },
          });
        }
        assert.equal(config.headers, undefined);
        return new Response(archive.get(Number(new URL(url).pathname.slice(1))));
      },
    });
  return {
    runs,
    calls,
    archive,
    plans,
    artifacts,
    certificate,
    options: {
      ...identity,
      now: timestamp,
      request,
      readArtifact,
      verifyCertification: async () => certificate,
    },
  };
}

test('adopts existing full integration and final candidate, preserving valid older untouched producer cells', async () => {
  const fixture = remoteFixture();
  const result = await verifyRemoteFullEvidence(fixture.options);
  assert.equal(result.status, 0);
  assert.equal(result.evidence.integration.full, true);
  assert.equal(result.evidence.candidate.binding.runAttempt, 3);
  assert.ok(
    fixture.calls.every(
      (path) =>
        !/dispatch|rerun|release/.test(path.replace('release-candidate.yml', 'candidate.yml')),
    ),
  );
});

test('final candidate can certify a complete latest full integration run without rerunning its suites', async () => {
  const fixture = remoteFixture();
  const result = await verifyRemoteIntegrationEvidence({
    ...identity,
    token: 'fixture-token',
    request: fixture.options.request,
    verifyCertification: async () => fixture.certificate,
    readArtifact: fixture.options.readArtifact,
    now: timestamp,
  });
  assert.equal(result.status, 0);
  assert.equal(result.evidence.integration.binding.runId, 17);
  assert.equal(result.evidence.integration.plan.documents['ci-plan.json'].profile, 'integration');
  assert.equal(
    validateAdoptionPlanPair(
      result.evidence.integration.plan.documents['ci-plan.json'],
      fixture.plans.candidate,
      identity,
    ).length,
    0,
  );
});

test('candidate preflight accepts only full matching integration evidence and records immutable provenance', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'varve-candidate-adoption-'));
  try {
    const candidatePlan = fullPlan('candidate');
    const integrationPlan = fullPlan('integration');
    const planPath = join(folder, 'ci-plan.json');
    const outputPath = join(folder, 'adoption.json');
    const githubOutput = join(folder, 'github-output');
    writeFileSync(planPath, JSON.stringify(candidatePlan));
    const integration = {
      commitSha: identity.commitSha,
      treeSha: identity.treeSha,
      policyVersion: POLICY_VERSION,
      policyHash: identity.policyHash,
      planHash: integrationPlan.planHash,
      binding: { runId: 17, runAttempt: 2 },
      plan: { artifactId: 31, digest: `sha256:${'1'.repeat(64)}` },
      summary: { artifactId: 32, digest: `sha256:${'2'.repeat(64)}` },
    };
    const environment = {
      GITHUB_REPOSITORY: identity.repo,
      GITHUB_TOKEN: 'fixture-token',
      EXPECTED_SHA: identity.commitSha,
      EXPECTED_TREE_SHA: identity.treeSha,
      EXPECTED_POLICY_HASH: identity.policyHash,
      GITHUB_OUTPUT: githubOutput,
    };
    const adoption = await verifyCandidateIntegration({
      planPath,
      outputPath,
      environment,
      verify: async () => ({
        status: 0,
        evidence: {
          integration: {
            ...integration,
            plan: {
              ...integration.plan,
              documents: { 'ci-plan.json': integrationPlan },
            },
          },
        },
      }),
    });
    assert.equal(adoption.integrationEvidence.binding.runId, 17);
    assert.equal(
      JSON.parse(readFileSync(outputPath, 'utf8')).integrationEvidence.summary.artifactId,
      32,
    );
    assert.equal(readFileSync(outputPath, 'utf8').includes('fixture-token'), false);
    assert.match(readFileSync(githubOutput, 'utf8'), /adoption_json=/);
    await assert.rejects(
      () =>
        verifyCandidateIntegration({
          planPath,
          outputPath,
          environment,
          verify: async () => ({
            status: 1,
            classification: 'incomplete-full-integration',
            errors: ['full browser coverage is missing'],
          }),
        }),
      /full CI workflow for this exact master SHA/,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('producer JSON browser histories certify compact summaries; missing or contradictory histories fail closed', () => {
  const plan = fullPlan('integration');
  const binding = { runId: 17, runAttempt: 1 };
  const valid = fullAggregate(plan, binding);
  assert.equal(valid.passed, true);
  const browser = valid.execution.evidence.filter((entry) => entry.browserReports.length);
  assert.equal(
    browser.find((entry) => entry.category === 'e2e').browserReports.length,
    FULL_BROWSER_SHARDS + 1,
  );
  for (const entry of browser)
    for (const report of entry.browserReports) {
      assert.match(report.sha256, /^[a-f0-9]{64}$/);
      assert.match(report.historySha256, /^[a-f0-9]{64}$/);
      assert.ok(report.stats.expected >= 1);
      assert.equal(Object.hasOwn(report, 'cases'), false);
    }
  for (const mutate of [
    (report) => ({ ...report, playwright: null }),
    (report) => ({ ...report, playwright: { ...report.playwright, reports: [] } }),
    (report) => ({
      ...report,
      playwright: {
        ...report.playwright,
        reports: report.playwright.reports.map((browser) => ({
          ...browser,
          stats: { ...browser.stats, unexpected: 1 },
        })),
      },
    }),
    (report) => ({
      ...report,
      playwright: {
        ...report.playwright,
        reports: report.playwright.reports.map((browser) => ({
          ...browser,
          historySha256: '0'.repeat(64),
        })),
      },
    }),
  ]) {
    const aggregate = fullAggregate(plan, binding, (report) =>
      report.category === 'e2e' ? mutate(report) : report,
    );
    assert.equal(aggregate.passed, false);
    assert.ok(validateFullAggregate(aggregate, plan, binding).length);
    assert.ok(aggregate.failures.some((failure) => /browser|history|case/.test(failure.reason)));
  }
});

test('partial, triage, different tree/policy and missing shard plans fail closed', () => {
  for (const change of [
    { globalImpact: false },
    { candidateMode: 'triage' },
    { treeSha: 'd'.repeat(40) },
    { policyHash: 'd'.repeat(64) },
    { e2eShardCount: 7 },
    { deferredLanes: ['e2e:all'] },
  ])
    assert.ok(
      validateFullPlan({ ...fullPlan('candidate'), ...change }, identity, 'candidate').length,
    );
});

test('summary rejects missing platform, future attempt, selected skip and unexecuted lane', () => {
  const plan = fullPlan('candidate');
  const binding = { runId: 18, runAttempt: 3 };
  const original = fullAggregate(plan, binding);
  assert.equal(original.passed, true);
  assert.deepEqual(validateFullAggregate(original, plan, binding), []);
  for (const mutate of [
    (a) => {
      a.execution.evidence.find((e) => e.category === 'rust').reports.pop();
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'rust').attempts[0].attempt = 4;
    },
    (a) => {
      a.jobs.find((job) => job.job === 'js').status = 'skipped';
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'visual').coveredLanes = [];
    },
  ]) {
    const aggregate = structuredClone(original);
    mutate(aggregate);
    assert.ok(validateFullAggregate(aggregate, plan, binding).length);
  }
});

test('compact summary rejects contradictory browser counts, incomplete cells and borrowed category lanes', () => {
  const plan = fullPlan('integration');
  const binding = { runId: 17, runAttempt: 1 };
  const original = fullAggregate(plan, binding);
  assert.deepEqual(validateFullAggregate(original, plan, binding), []);
  for (const mutate of [
    (a) => {
      a.execution.evidence.find((e) => e.category === 'e2e').browserReports[0].stats.unexpected = 1;
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'e2e').browserReports[0].stats.flaky = 1;
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'e2e').browserReports[0].historySha256 = null;
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'e2e').browserReports[0].sha256 = 'invalid';
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'e2e').browserReports[0].lane = 'website-e2e';
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'e2e').browserReports[0].cell =
        `e2e:ubuntu-latest:${FULL_BROWSER_SHARDS + 1}/${FULL_BROWSER_SHARDS}`;
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'e2e').browserReports.pop();
    },
    (a) => {
      const e = a.execution.evidence.find((e) => e.category === 'rust');
      e.attempts = e.attempts.map(() => ({ ...e.attempts[0] }));
    },
    (a) => {
      const r = a.execution.evidence.find((e) => e.category === 'rust'),
        p = a.execution.evidence.find((e) => e.category === 'pipeline');
      p.coveredLanes.push(...r.coveredLanes);
      r.coveredLanes = [];
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'rust').attempts = {};
    },
    (a) => {
      a.execution.evidence.find((e) => e.category === 'e2e').browserReports = null;
    },
    (a) => {
      a.execution.evidence = {};
    },
    (a) => {
      a.jobs = null;
    },
  ]) {
    const mutated = structuredClone(original);
    mutate(mutated);
    assert.ok(validateFullAggregate(mutated, plan, binding).length);
  }
  const dual = structuredClone(original);
  const e2e = dual.execution.evidence.find((e) => e.category === 'e2e');
  e2e.browserReports.push({
    ...e2e.browserReports[0],
    sha256: 'd'.repeat(64),
    historySha256: 'e'.repeat(64),
  });
  assert.deepEqual(
    validateFullAggregate(dual, plan, binding),
    [],
    'CPU/GPU reports may share one cell/lane',
  );
});

test('new queued run supersedes old green certificate without dispatching or local tests', async () => {
  const fixture = remoteFixture();
  fixture.runs.candidate.push({
    ...fixture.runs.candidate[0],
    id: 30,
    status: 'queued',
    conclusion: null,
  });
  const result = await verifyRemoteFullEvidence({
    ...fixture.options,
    verifyCertification: () => assert.fail('must not adopt older green'),
  });
  assert.equal(result.status, 2);
  assert.equal(result.classification, 'pending');
});

test('billing startup and real executed failure have different non-pass statuses', async () => {
  for (const code of [false, true]) {
    const fixture = remoteFixture();
    fixture.runs.candidate.push({ ...fixture.runs.candidate[0], id: 30, conclusion: 'failure' });
    const originalRequest = fixture.options.request;
    fixture.options.request = async (path) => {
      if (path.includes('/runs/30/attempts/3/jobs?'))
        return {
          jobs: [
            {
              name: 'blocked job',
              conclusion: 'failure',
              check_run_url: 'https://api.github.com/repos/owner/repo/check-runs/555',
              steps: code ? [{ conclusion: 'failure' }] : [],
            },
          ],
        };
      if (path.includes('/check-runs/555/annotations?'))
        return [{ message: 'The job was not started because recent account payments have failed' }];
      return originalRequest(path);
    };
    const result = await verifyRemoteFullEvidence(fixture.options);
    assert.equal(result.status, code ? 1 : 3);
    assert.equal(result.classification, code ? 'code-failure' : 'external-blocked');
  }
});

test('actual evidence expiry and immutable archive digest prevent accepting an old pass', async () => {
  for (const expiry of [true, false]) {
    const fixture = remoteFixture();
    if (expiry) fixture.certificate.artifact.expires_at = '2026-10-01T00:00:00Z';
    else fixture.certificate.artifact.digest = `sha256:${'0'.repeat(64)}`;
    await assert.rejects(
      () => verifyRemoteFullEvidence(fixture.options),
      expiry ? /expired/ : /digest mismatch/,
    );
  }
});

test('a rerun at the same SHA must match newest producer attempt; current master mismatch rejects', async () => {
  const fixture = remoteFixture();
  fixture.runs.candidate[0].run_attempt = 4;
  await assert.rejects(() => verifyRemoteFullEvidence(fixture.options), /newer candidate/);
  const wrongMaster = remoteFixture();
  const request = wrongMaster.options.request;
  wrongMaster.options.request = (path) =>
    path.endsWith('/git/ref/heads/master') ? { object: { sha: 'e'.repeat(40) } } : request(path);
  await assert.rejects(
    () => verifyRemoteFullEvidence(wrongMaster.options),
    /accepted current master/,
  );
});

test('a new dispatch appearing during archive download cannot hide behind the old custom check', async () => {
  const fixture = remoteFixture();
  const readArtifact = fixture.options.readArtifact;
  let injected = false;
  fixture.options.readArtifact = async (options) => {
    const result = await readArtifact(options);
    if (!injected && options.names.includes('candidate-certification.json')) {
      injected = true;
      fixture.runs.candidate.push({
        ...fixture.runs.candidate[0],
        id: 31,
        status: 'queued',
        conclusion: null,
      });
    }
    return result;
  };
  const result = await verifyRemoteFullEvidence(fixture.options);
  assert.equal(result.status, 2);
  assert.equal(result.classification, 'superseded-during-verification');
});

test('unavailable metadata is an external non-pass, without leaking request credentials', async () => {
  const reader = githubReader('private-fixture', async (_url, options) => {
    assert.ok(options.signal);
    return new Response('private error content must not enter the journal', { status: 429 });
  });
  await assert.rejects(
    () => reader('/repos/owner/repo/actions/runs'),
    (error) => error.external === true && error.message === 'GitHub metadata request failed (429)',
  );
});

test('CLI journal preserves pending state, does not run broad lanes, and never stores token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'varve-remote-full-'));
  const git = (argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git(['init', '-q', '-b', 'master']);
    git(['config', 'user.name', 'Remote gate fixture']);
    git(['config', 'user.email', 'remote-gate@example.invalid']);
    git(['config', 'core.hooksPath', '/dev/null']);
    writeFileSync(join(root, 'source.js'), 'export const value = 1;\n');
    git(['add', 'source.js']);
    git(['commit', '-qm', 'candidate']);
    const pending = await runRemoteFullGate({
      root,
      environment: { GITHUB_REPOSITORY: identity.repo, GITHUB_TOKEN: identity.token },
      verify: async () => ({ status: 2, classification: 'pending' }),
      execute: () => assert.fail('pending remote gate must not launch local suite'),
    });
    assert.equal(pending.status, 2);
    const journal = readFileSync(pending.operationPath, 'utf8');
    assert.equal(JSON.parse(journal).status, 'incomplete');
    assert.ok(!journal.includes(identity.token));
    let verified = 0;
    let complemented = 0;
    const fixture = remoteFixture();
    const remote = await verifyRemoteFullEvidence(fixture.options);
    const passed = await runRemoteFullGate({
      root,
      args: ['--resume'],
      environment: { GITHUB_REPOSITORY: identity.repo, GITHUB_TOKEN: identity.token },
      verify: async () => {
        verified++;
        return remote;
      },
      complement: async (lanes, options) => {
        complemented++;
        assert.equal(options.resume, true);
        assert.deepEqual(lanes, REMOTE_FULL_COMPLEMENT);
        assert.ok(lanes.every((lane) => !/vitest|playwright|cargo/.test(lane.argv.join(' '))));
        return { status: 0, outcomes: [] };
      },
    });
    assert.equal(passed.status, 0);
    assert.equal(verified, 2, 'newest remote evidence is rechecked after local audit complement');
    assert.equal(complemented, 1);
    assert.equal(JSON.parse(readFileSync(passed.operationPath, 'utf8')).status, 'completed');
    const statusOnly = await runRemoteFullGate({
      root,
      args: ['--status'],
      environment: { GITHUB_REPOSITORY: identity.repo, GITHUB_TOKEN: identity.token },
      verify: async () => remote,
      complement: () => assert.fail('status only must not execute'),
    });
    assert.equal(statusOnly.status, 2, 'status only must not claim full gate completion');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

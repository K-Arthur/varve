#!/usr/bin/env node

/** Exact-SHA integration/candidate evidence tests. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POLICY_VERSION } from '../quality/validation-policy.mjs';
import {
  buildCandidateEvidence,
  CANDIDATE_CHECK_NAME,
  candidateArtifactName,
  findExactCandidateArtifact,
  findExactIntegrationArtifact,
  findSuccessfulExactCheck,
  integrationArtifactName,
  validateLocalCandidateEvidence,
  verifyRemoteCertification,
} from './certification.mjs';
import { parseArgs as parseCertificationArgs } from './verify-certification.mjs';

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const policyHash = 'c'.repeat(64);
const repo = 'K-Arthur/varve';
const runStartedAt = '2026-10-02T00:00:00Z';
const integrationBinding = { runId: 17, runAttempt: 2, runStartedAt };
const candidateBinding = { runId: 18, runAttempt: 3, runStartedAt };
function makeCheck(name, headSha, id, overrides = {}) {
  return {
    id,
    name,
    head_sha: headSha,
    status: 'completed',
    conclusion: 'success',
    app: { id: 15368, slug: 'github-actions' },
    started_at: runStartedAt,
    ...overrides,
  };
}
const checks = [
  makeCheck(CANDIDATE_CHECK_NAME, otherSha, 201),
  makeCheck(CANDIDATE_CHECK_NAME, sha, 202, { conclusion: 'failure' }),
  makeCheck(CANDIDATE_CHECK_NAME, sha, 203),
];
assert.equal(
  findSuccessfulExactCheck(checks, { name: CANDIDATE_CHECK_NAME, commitSha: sha }).head_sha,
  sha,
);
assert.equal(
  findSuccessfulExactCheck(checks, { name: CANDIDATE_CHECK_NAME, commitSha: otherSha }).head_sha,
  otherSha,
);
assert.equal(
  findSuccessfulExactCheck(checks, { name: CANDIDATE_CHECK_NAME, commitSha: 'd'.repeat(40) }),
  null,
);

const artifact = {
  name: `${candidateArtifactName(sha, policyHash)}-run-18-attempt-3`,
  expired: false,
  created_at: '2026-10-02T00:01:00Z',
  workflow_run: { id: 18, head_sha: sha },
};
const candidateOptions = { commitSha: sha, policyHash, binding: candidateBinding };
assert.equal(findExactCandidateArtifact([artifact], candidateOptions), artifact);
assert.equal(findExactCandidateArtifact([{ ...artifact, expired: true }], candidateOptions), null);
const integrationArtifact = {
  ...artifact,
  name: `${integrationArtifactName(sha, policyHash)}-run-17-attempt-2`,
  workflow_run: { id: 17, head_sha: sha },
};
const integrationOptions = { commitSha: sha, policyHash, binding: integrationBinding };
assert.equal(
  findExactIntegrationArtifact([integrationArtifact], integrationOptions),
  integrationArtifact,
);
assert.equal(
  findExactIntegrationArtifact(
    [{ name: integrationArtifactName(otherSha, policyHash), expired: false }],
    integrationOptions,
  ),
  null,
);
assert.equal(
  findExactCandidateArtifact(
    [{ name: candidateArtifactName(otherSha, policyHash) }],
    candidateOptions,
  ),
  null,
);

const oldGreen = makeCheck(CANDIDATE_CHECK_NAME, sha, 200);
for (const latest of [
  makeCheck(CANDIDATE_CHECK_NAME, sha, 204, { conclusion: 'failure' }),
  makeCheck(CANDIDATE_CHECK_NAME, sha, 204, { status: 'in_progress', conclusion: null }),
  makeCheck(CANDIDATE_CHECK_NAME, sha, 204, {
    status: 'queued',
    conclusion: null,
    started_at: null,
  }),
]) {
  assert.equal(
    findSuccessfulExactCheck([oldGreen, latest], { name: CANDIDATE_CHECK_NAME, commitSha: sha }),
    null,
    'a newer unsuccessful check must not fall back to an old success',
  );
}
assert.equal(
  findSuccessfulExactCheck(
    [oldGreen, makeCheck(CANDIDATE_CHECK_NAME, sha, 999, { app: { id: 1, slug: 'impostor' } })],
    { name: CANDIDATE_CHECK_NAME, commitSha: sha },
  ),
  oldGreen,
  'only the trusted Actions issuer can certify',
);
for (const stale of [
  { ...artifact, name: candidateArtifactName(sha, policyHash) },
  { ...artifact, name: `${candidateArtifactName(sha, policyHash)}-run-18-attempt-2` },
  { ...artifact, name: `${artifact.name}-extra` },
  { ...artifact, workflow_run: { id: 17, head_sha: sha } },
  { ...artifact, workflow_run: { id: 18, head_sha: otherSha } },
  { ...artifact, workflow_run: undefined },
  { ...artifact, created_at: '2026-10-01T23:59:59Z' },
]) {
  assert.equal(findExactCandidateArtifact([stale], candidateOptions), null);
}

const evidence = buildCandidateEvidence({
  commitSha: sha,
  policyHash,
  aggregate: {
    passed: true,
    selectedLanes: ['js-unit:all'],
    deferredLanes: [],
    jobs: [],
    failures: [],
  },
  runId: 17,
  generatedAt: '2026-08-31T00:00:00Z',
});
assert.equal(evidence.status, 'passed');
assert.equal(evidence.mode, 'final');
assert.equal(evidence.certifiable, true);
assert.deepEqual(validateLocalCandidateEvidence(evidence, { commitSha: sha, policyHash }), []);
assert.ok(
  validateLocalCandidateEvidence(evidence, { commitSha: otherSha, policyHash }).some((error) =>
    error.includes('commit SHA'),
  ),
);
assert.ok(
  validateLocalCandidateEvidence(
    { ...evidence, policyHash: 'd'.repeat(64) },
    { commitSha: sha, policyHash },
  ).some((error) => error.includes('policy hash')),
);
assert.equal(evidence.policyVersion, POLICY_VERSION);
assert.equal(parseCertificationArgs(['--integration-only']).integrationOnly, true);

const triageEvidence = buildCandidateEvidence({
  commitSha: sha,
  policyHash,
  mode: 'triage',
  aggregate: { passed: true, selectedLanes: [], deferredLanes: [], jobs: [], failures: [] },
});
assert.equal(triageEvidence.status, 'triage-passed');
assert.equal(triageEvidence.certifiable, false);
assert.ok(
  validateLocalCandidateEvidence(triageEvidence, { commitSha: sha, policyHash }).some((error) =>
    error.includes('not final mode'),
  ),
);

// Exercise the release-facing API gate without network access: a wrong-SHA or
// missing candidate is a hard failure, while integration-only mode accepts
// only the exact integration check and policy-bound evidence artifact.
const originalFetch = globalThis.fetch;
const integrationCheck = makeCheck('CI / certification', sha, 300, {
  details_url: `https://github.com/${repo}/actions/runs/17/job/300`,
  external_id: 'builtin-job-uuid',
});
const candidateCheck = makeCheck(CANDIDATE_CHECK_NAME, sha, 301, {
  details_url: `https://github.com/${repo}/actions/runs/18`,
  external_id: '18:3',
});
const integrationJob = {
  id: 300,
  run_id: 17,
  run_attempt: 2,
  head_sha: sha,
  name: 'CI / certification',
  status: 'completed',
  conclusion: 'success',
  check_run_url: `https://api.github.com/repos/${repo}/check-runs/300`,
};
const integrationRun = {
  id: 17,
  run_attempt: 2,
  head_sha: sha,
  status: 'completed',
  conclusion: 'success',
  path: '.github/workflows/ci.yml',
  run_started_at: runStartedAt,
};
const candidateRun = {
  ...integrationRun,
  id: 18,
  run_attempt: 3,
  path: '.github/workflows/release-candidate.yml',
};
try {
  globalThis.fetch = async (url) => {
    const endpoint = String(url);
    let body;
    if (endpoint.includes('/check-runs')) {
      body = { check_runs: [integrationCheck, { ...candidateCheck, head_sha: otherSha }] };
    } else if (endpoint.endsWith('/actions/jobs/300')) body = integrationJob;
    else if (endpoint.endsWith('/actions/runs/17')) body = integrationRun;
    else body = { artifacts: [integrationArtifact] };
    return { ok: true, text: async () => JSON.stringify(body) };
  };
  const integrationOnly = await verifyRemoteCertification({
    repo: 'K-Arthur/varve',
    commitSha: sha,
    policyHash,
    token: 'test-token',
    requireCandidate: false,
  });
  assert.equal(integrationOnly.ok, true);
  const missingCandidate = await verifyRemoteCertification({
    repo: 'K-Arthur/varve',
    commitSha: sha,
    policyHash,
    token: 'test-token',
  });
  assert.equal(missingCandidate.ok, false);
  assert.ok(missingCandidate.errors.some((error) => error.includes('Release Candidate')));
  assert.ok(missingCandidate.errors.some((error) => error.includes('candidate evidence')));
} finally {
  globalThis.fetch = originalFetch;
}

async function remoteResult(overrides = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const endpoint = String(url);
    calls.push(endpoint);
    let body;
    if (endpoint.includes('/check-runs')) {
      const page = Number(new URL(endpoint).searchParams.get('page'));
      body = {
        check_runs: overrides.checkPages?.[page - 1] ??
          overrides.checks ?? [integrationCheck, candidateCheck],
      };
    } else if (endpoint.endsWith('/actions/jobs/300')) body = overrides.job ?? integrationJob;
    else if (endpoint.endsWith('/actions/runs/17'))
      body = overrides.integrationRun ?? integrationRun;
    else if (endpoint.endsWith('/actions/runs/18')) body = overrides.candidateRun ?? candidateRun;
    else if (endpoint.includes('/actions/artifacts'))
      body = { artifacts: overrides.artifacts ?? [integrationArtifact, artifact] };
    else throw new Error(`Unexpected certification API request: ${endpoint}`);
    return { ok: true, text: async () => JSON.stringify(body) };
  };
  try {
    const result = await verifyRemoteCertification({
      repo,
      commitSha: sha,
      policyHash,
      token: 'test-token',
    });
    return { result, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const certified = await remoteResult();
assert.equal(certified.result.ok, true);
assert.deepEqual(certified.result.integrationBinding, integrationBinding);
assert.deepEqual(certified.result.candidateBinding, candidateBinding);
assert.ok(certified.calls.some((url) => url.includes('filter=all&app_id=15368')));
assert.ok(certified.calls.some((url) => url.endsWith('/actions/jobs/300')));

for (const overrides of [
  {
    checks: [
      integrationCheck,
      candidateCheck,
      { ...candidateCheck, id: 302, status: 'queued', conclusion: null },
    ],
  },
  { checks: [integrationCheck, { ...candidateCheck, external_id: '18:2' }] },
  { checks: [integrationCheck, { ...candidateCheck, external_id: '' }] },
  {
    checks: [
      integrationCheck,
      { ...candidateCheck, details_url: 'https://github.com/another/repo/actions/runs/18' },
    ],
  },
  { checks: [{ ...integrationCheck, app: { id: 999, slug: 'github-actions' } }, candidateCheck] },
  { job: { ...integrationJob, run_attempt: 1 } },
  {
    job: {
      ...integrationJob,
      check_run_url: `https://api.github.com/repos/${repo}/check-runs/999`,
    },
  },
  { job: { ...integrationJob, head_sha: otherSha } },
  { candidateRun: { ...candidateRun, run_attempt: 4 } },
  { candidateRun: { ...candidateRun, status: 'in_progress', conclusion: null } },
  { candidateRun: { ...candidateRun, conclusion: 'failure' } },
  { candidateRun: { ...candidateRun, path: '.github/workflows/untrusted.yml' } },
  { artifacts: [integrationArtifact, { ...artifact, workflow_run: { id: 17, head_sha: sha } }] },
]) {
  const { result } = await remoteResult(overrides);
  assert.equal(
    result.ok,
    false,
    `reject stale or unbound remote evidence: ${JSON.stringify(overrides)}`,
  );
}

const firstPage = [
  integrationCheck,
  candidateCheck,
  ...Array.from({ length: 98 }, (_, index) => makeCheck(`Other ${index}`, sha, 400 + index)),
];
const paginated = await remoteResult({
  checkPages: [
    firstPage,
    [{ ...candidateCheck, id: 600, status: 'in_progress', conclusion: null }],
  ],
});
assert.equal(
  paginated.result.ok,
  false,
  'a newer check on the next API page must invalidate old success',
);
assert.ok(paginated.calls.some((url) => url.includes('page=2')));

// Release must verify certification before the first dependency install or
// platform build; this guards against regressions to the old repeated gate.
const release = readFileSync('.github/workflows/release.yml', 'utf8');
const cert = release.indexOf('Verify exact-SHA integration and release-candidate certification');
const install = release.indexOf('pnpm install --frozen-lockfile', cert);
const bundle = release.indexOf('name: Bundle', cert);
assert.ok(
  cert >= 0 && install > cert && bundle > cert,
  'exact certification gate precedes release setup/builds',
);
const websiteWorkflow = readFileSync('.github/workflows/website-deploy.yml', 'utf8');
assert.match(websiteWorkflow, /source_sha: \$\{\{ steps\.source\.outputs\.source_sha \}\}/);
assert.match(websiteWorkflow, /ref: \$\{\{ needs\.build\.outputs\.source_sha \}\}/);
assert.match(websiteWorkflow, /Verify exact deployed source/);
assert.doesNotMatch(
  websiteWorkflow,
  /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
  'website build/deploy must not silently use the moving default branch',
);

console.log('release certification tests passed');

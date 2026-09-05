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
const checks = [
  { name: CANDIDATE_CHECK_NAME, head_sha: otherSha, status: 'completed', conclusion: 'success' },
  { name: CANDIDATE_CHECK_NAME, head_sha: sha, status: 'completed', conclusion: 'failure' },
  { name: CANDIDATE_CHECK_NAME, head_sha: sha, status: 'completed', conclusion: 'success' },
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

const artifact = { name: candidateArtifactName(sha, policyHash), expired: false };
assert.equal(findExactCandidateArtifact([artifact], { commitSha: sha, policyHash }), artifact);
assert.equal(
  findExactCandidateArtifact([{ ...artifact, expired: true }], { commitSha: sha, policyHash }),
  null,
);
const integrationArtifact = { name: integrationArtifactName(sha, policyHash), expired: false };
assert.equal(
  findExactIntegrationArtifact([integrationArtifact], { commitSha: sha, policyHash }),
  integrationArtifact,
);
assert.equal(
  findExactIntegrationArtifact(
    [{ name: integrationArtifactName(otherSha, policyHash), expired: false }],
    { commitSha: sha, policyHash },
  ),
  null,
);
assert.equal(
  findExactCandidateArtifact([{ name: candidateArtifactName(otherSha, policyHash) }], {
    commitSha: sha,
    policyHash,
  }),
  null,
);

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

// Exercise the release-facing API gate without network access: a wrong-SHA or
// missing candidate is a hard failure, while integration-only mode accepts
// only the exact integration check and policy-bound evidence artifact.
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) => {
    const body = String(url).includes('/check-runs')
      ? {
          check_runs: [
            {
              name: 'CI / certification',
              head_sha: sha,
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Release Candidate / certification',
              head_sha: otherSha,
              status: 'completed',
              conclusion: 'success',
            },
          ],
        }
      : {
          artifacts: [integrationArtifact],
        };
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

console.log('release certification tests passed');

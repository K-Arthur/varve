#!/usr/bin/env node

/** Exact-SHA integration/candidate certification helpers. */

import { createHash } from 'node:crypto';
import { computePolicyHash, POLICY_VERSION } from '../quality/validation-policy.mjs';

export const INTEGRATION_CHECK_NAME = 'CI / certification';
export const CANDIDATE_CHECK_NAME = 'Release Candidate / certification';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function candidateArtifactName(commitSha, policyHash) {
  return `varve-release-candidate-${commitSha}-${policyHash}`;
}

export function integrationArtifactName(commitSha, policyHash) {
  return `varve-ci-certification-${commitSha}-${policyHash}`;
}

export function findSuccessfulExactCheck(checkRuns, { name, commitSha }) {
  return (
    (checkRuns ?? []).find(
      (check) =>
        check.name === name &&
        (check.head_sha ?? check.headSha) === commitSha &&
        check.status === 'completed' &&
        check.conclusion === 'success',
    ) ?? null
  );
}

export function findExactCandidateArtifact(artifacts, { commitSha, policyHash }) {
  const expected = candidateArtifactName(commitSha, policyHash);
  return (
    (artifacts ?? []).find(
      (artifact) =>
        artifact.name === expected &&
        artifact.expired !== true &&
        (!artifact.workflow_run?.head_sha || artifact.workflow_run.head_sha === commitSha),
    ) ?? null
  );
}

export function findExactIntegrationArtifact(artifacts, { commitSha, policyHash }) {
  const expected = integrationArtifactName(commitSha, policyHash);
  return (
    (artifacts ?? []).find(
      (artifact) =>
        artifact.name === expected &&
        artifact.expired !== true &&
        (!artifact.workflow_run?.head_sha || artifact.workflow_run.head_sha === commitSha),
    ) ?? null
  );
}

export function validateLocalCandidateEvidence(evidence, { commitSha, policyHash }) {
  const errors = [];
  if (evidence?.schema !== 1) errors.push('candidate evidence schema must be 1');
  if (evidence?.commitSha !== commitSha) errors.push('candidate evidence commit SHA mismatch');
  if (evidence?.policyHash !== policyHash) errors.push('candidate evidence policy hash mismatch');
  if (evidence?.policyVersion !== POLICY_VERSION)
    errors.push('candidate evidence policy version mismatch');
  if (evidence?.status !== 'passed') errors.push('candidate evidence is not passed');
  return errors;
}

export function buildCandidateEvidence({
  commitSha,
  policyHash,
  aggregate,
  runId = process.env.GITHUB_RUN_ID ?? null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const status = aggregate?.passed ? 'passed' : 'failed';
  const evidence = {
    schema: 1,
    status,
    commitSha,
    policyVersion: POLICY_VERSION,
    policyHash,
    runId,
    profile: 'candidate',
    selectedLanes: aggregate?.selectedLanes ?? [],
    deferredLanes: aggregate?.deferredLanes ?? [],
    jobs: aggregate?.jobs ?? [],
    failures: aggregate?.failures ?? [],
    generatedAt,
  };
  return {
    ...evidence,
    evidenceHash: sha256(JSON.stringify(evidence)),
  };
}

async function githubJson(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`GitHub API ${response.status} for ${path}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

async function listArtifacts(owner, name, token) {
  const artifacts = [];
  // Candidate evidence may be older than the first page of artifacts. Keep
  // pagination bounded, but do not make “latest 100” an accidental validity
  // rule for a frozen release candidate.
  for (let page = 1; page <= 100; page += 1) {
    const data = await githubJson(
      `/repos/${owner}/${name}/actions/artifacts?per_page=100&page=${page}`,
      token,
    );
    const pageArtifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    artifacts.push(...pageArtifacts);
    if (pageArtifacts.length < 100) break;
  }
  return artifacts;
}

export async function verifyRemoteCertification({
  repo,
  commitSha,
  policyHash = computePolicyHash(),
  token = process.env.GITHUB_TOKEN,
  requireCandidate = true,
} = {}) {
  if (!repo || !commitSha) throw new Error('repo and commitSha are required');
  if (!token) throw new Error('GITHUB_TOKEN with checks/actions read access is required');
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`invalid GitHub repository '${repo}'`);
  const checks = await githubJson(
    `/repos/${owner}/${name}/commits/${commitSha}/check-runs?per_page=100`,
    token,
  );
  const integration = findSuccessfulExactCheck(checks.check_runs, {
    name: INTEGRATION_CHECK_NAME,
    commitSha,
  });
  const candidate = findSuccessfulExactCheck(checks.check_runs, {
    name: CANDIDATE_CHECK_NAME,
    commitSha,
  });
  const artifacts = await listArtifacts(owner, name, token);
  const integrationArtifact = findExactIntegrationArtifact(artifacts, {
    commitSha,
    policyHash,
  });
  const artifact = requireCandidate
    ? findExactCandidateArtifact(artifacts, { commitSha, policyHash })
    : null;
  const errors = [];
  if (!integration) errors.push(`missing successful '${INTEGRATION_CHECK_NAME}' for ${commitSha}`);
  if (!integrationArtifact)
    errors.push(
      `missing unexpired integration evidence artifact for ${commitSha} and policy ${policyHash}`,
    );
  if (requireCandidate && !candidate)
    errors.push(`missing successful '${CANDIDATE_CHECK_NAME}' for ${commitSha}`);
  if (requireCandidate && !artifact)
    errors.push(
      `missing unexpired candidate evidence artifact for ${commitSha} and policy ${policyHash}`,
    );
  return {
    ok: errors.length === 0,
    commitSha,
    policyVersion: POLICY_VERSION,
    policyHash,
    integration,
    integrationArtifact,
    candidate,
    artifact,
    errors,
  };
}

#!/usr/bin/env node

/** Exact-SHA integration/candidate certification helpers. */

import { createHash } from 'node:crypto';
import { computePolicyHash, POLICY_VERSION } from '../quality/validation-policy.mjs';

export const INTEGRATION_CHECK_NAME = 'CI / certification';
export const CANDIDATE_CHECK_NAME = 'Release Candidate / certification';
const ACTIONS_APP_ID = 15368;

function positiveId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)))
    return null;
  return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function trustedCheck(check) {
  return check.app?.id === ACTIONS_APP_ID && check.app?.slug === 'github-actions';
}

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
  const exact = (checkRuns ?? []).filter(
    (check) =>
      check.name === name && (check.head_sha ?? check.headSha) === commitSha && trustedCheck(check),
  );
  // Check IDs order creation, including queued checks with no start time.
  // Never search backwards for an older green result after a retry fails.
  if (exact.some((check) => !positiveId(check.id))) return null;
  exact.sort(
    (a, b) =>
      Number(b.id) - Number(a.id) ||
      (Date.parse(b.started_at) || 0) - (Date.parse(a.started_at) || 0),
  );
  const latest = exact[0];
  return latest?.status === 'completed' && latest.conclusion === 'success' ? latest : null;
}

function findBoundArtifact(artifacts, baseName, { commitSha, binding }) {
  if (!binding?.runId || !binding.runAttempt) return null;
  const expected = `${baseName}-run-${binding.runId}-attempt-${binding.runAttempt}`;
  const startedAt = Date.parse(binding.runStartedAt);
  if (!Number.isFinite(startedAt)) return null;
  return (
    (artifacts ?? []).find(
      (artifact) =>
        artifact.name === expected &&
        artifact.expired === false &&
        positiveId(artifact.workflow_run?.id) === binding.runId &&
        artifact.workflow_run?.head_sha === commitSha &&
        Date.parse(artifact.created_at) >= startedAt,
    ) ?? null
  );
}

export function findExactCandidateArtifact(artifacts, options) {
  return findBoundArtifact(
    artifacts,
    candidateArtifactName(options.commitSha, options.policyHash),
    options,
  );
}

export function findExactIntegrationArtifact(artifacts, options) {
  return findBoundArtifact(
    artifacts,
    integrationArtifactName(options.commitSha, options.policyHash),
    options,
  );
}

export function validateLocalCandidateEvidence(evidence, { commitSha, policyHash }) {
  const errors = [];
  if (evidence?.schema !== 1) errors.push('candidate evidence schema must be 1');
  if (evidence?.commitSha !== commitSha) errors.push('candidate evidence commit SHA mismatch');
  if (evidence?.policyHash !== policyHash) errors.push('candidate evidence policy hash mismatch');
  if (evidence?.policyVersion !== POLICY_VERSION)
    errors.push('candidate evidence policy version mismatch');
  if (evidence?.mode !== 'final') errors.push('candidate evidence is not final mode');
  if (evidence?.status !== 'passed') errors.push('candidate evidence is not passed');
  return errors;
}

export function buildCandidateEvidence({
  commitSha,
  policyHash,
  aggregate,
  mode = 'final',
  runId = process.env.GITHUB_RUN_ID ?? null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!['triage', 'final'].includes(mode)) throw new Error(`invalid candidate mode '${mode}'`);
  const status =
    mode === 'triage'
      ? aggregate?.passed
        ? 'triage-passed'
        : 'triage-failed'
      : aggregate?.passed
        ? 'passed'
        : 'failed';
  const evidence = {
    schema: 1,
    status,
    commitSha,
    policyVersion: POLICY_VERSION,
    policyHash,
    runId,
    profile: 'candidate',
    mode,
    certifiable: mode === 'final' && status === 'passed',
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
    signal: AbortSignal.timeout(30_000),
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

async function listChecks(owner, name, commitSha, token) {
  const checks = [];
  for (let page = 1; page <= 100; page += 1) {
    // GitHub defaults to filter=latest, which can omit a queued retry when
    // grouping by completed time. Select the latest trusted check ourselves.
    const data = await githubJson(
      `/repos/${owner}/${name}/commits/${commitSha}/check-runs?filter=all&app_id=${ACTIONS_APP_ID}&per_page=100&page=${page}`,
      token,
    );
    const batch = Array.isArray(data.check_runs) ? data.check_runs : [];
    checks.push(...batch);
    if (batch.length < 100) return checks;
  }
  throw new Error('Exact-SHA check history exceeds the certification pagination limit');
}

/**
 * GitHub rewrites an API-created check-run's `details_url` to
 * `https://github.com/<owner>/<repo>/runs/<check_run_id>`, which carries no run
 * id. That form is trusted; any other unparsable URL is not.
 */
function isNormalisedCheckUrl(check, repo) {
  try {
    const url = new URL(check.details_url);
    if (url.origin !== 'https://github.com' || url.search || url.hash) return false;
    return new RegExp(`^/${repo}/runs/[1-9]\\d*$`, 'i').test(url.pathname);
  } catch {
    return false;
  }
}

function checkDetails(check, repo) {
  try {
    const url = new URL(check.details_url);
    const prefix = `/${repo}/actions/runs/`;
    if (
      url.origin !== 'https://github.com' ||
      url.search ||
      url.hash ||
      !url.pathname.toLowerCase().startsWith(prefix.toLowerCase())
    )
      return null;
    const match = url.pathname.slice(prefix.length).match(/^([1-9]\d*)(?:\/job\/([1-9]\d*))?$/);
    if (!match) return null;
    return { runId: positiveId(match[1]), jobId: match[2] ? positiveId(match[2]) : null };
  } catch {
    return null;
  }
}

async function bindSuccessfulCheck(check, { repo, commitSha, token, kind }) {
  if (!check) return null;
  const details = checkDetails(check, repo);
  let runId = details?.runId ?? null;
  let runAttempt;
  if (kind === 'integration') {
    if (!details?.runId || !details.jobId) return null;
    const job = await githubJson(`/repos/${repo}/actions/jobs/${details.jobId}`, token);
    if (
      job.id !== details.jobId ||
      job.run_id !== details.runId ||
      job.head_sha !== commitSha ||
      job.name !== INTEGRATION_CHECK_NAME ||
      job.status !== 'completed' ||
      job.conclusion !== 'success' ||
      job.check_run_url?.toLowerCase() !==
        `https://api.github.com/repos/${repo}/check-runs/${check.id}`.toLowerCase()
    )
      return null;
    runAttempt = positiveId(job.run_attempt);
  } else {
    // GitHub normalises an API-created check-run's details_url to
    // https://github.com/<owner>/<repo>/runs/<check_run_id>, which carries no run
    // id at all. Requiring a parsable /actions/runs/ URL therefore rejected
    // every candidate certification and no release could ever preflight. Accept
    // that exact normalised form (and only it) and read the run from the
    // external_id, cross-checking the URL whenever it does parse.
    if (!details && !isNormalisedCheckUrl(check, repo)) return null;
    const identity = String(check.external_id ?? '').match(/^([1-9]\d*):([1-9]\d*)$/);
    if (!identity || details?.jobId) return null;
    if (details?.runId && positiveId(identity[1]) !== details.runId) return null;
    runId = positiveId(identity[1]);
    runAttempt = positiveId(identity[2]);
  }
  if (!runId || !runAttempt) return null;
  const run = await githubJson(`/repos/${repo}/actions/runs/${runId}`, token);
  const workflow = kind === 'integration' ? 'ci.yml' : 'release-candidate.yml';
  if (
    run.id !== runId ||
    run.head_sha !== commitSha ||
    run.run_attempt !== runAttempt ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path?.split('@')[0] !== `.github/workflows/${workflow}` ||
    !Number.isFinite(Date.parse(run.run_started_at))
  )
    return null;
  return { runId, runAttempt, runStartedAt: run.run_started_at };
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
  const checks = await listChecks(owner, name, commitSha, token);
  const integration = findSuccessfulExactCheck(checks, {
    name: INTEGRATION_CHECK_NAME,
    commitSha,
  });
  const candidate = findSuccessfulExactCheck(checks, {
    name: CANDIDATE_CHECK_NAME,
    commitSha,
  });
  const integrationBinding = await bindSuccessfulCheck(integration, {
    repo,
    commitSha,
    token,
    kind: 'integration',
  });
  const candidateBinding = requireCandidate
    ? await bindSuccessfulCheck(candidate, { repo, commitSha, token, kind: 'candidate' })
    : null;
  const artifacts = await listArtifacts(owner, name, token);
  const integrationArtifact = findExactIntegrationArtifact(artifacts, {
    commitSha,
    policyHash,
    binding: integrationBinding,
  });
  const artifact = requireCandidate
    ? findExactCandidateArtifact(artifacts, { commitSha, policyHash, binding: candidateBinding })
    : null;
  const errors = [];
  if (!integration || !integrationBinding)
    errors.push(
      `latest trusted '${INTEGRATION_CHECK_NAME}' is not a successful exact run/attempt for ${commitSha}`,
    );
  if (!integrationArtifact)
    errors.push(
      `missing unexpired integration evidence artifact for ${commitSha} and policy ${policyHash}`,
    );
  if (requireCandidate && (!candidate || !candidateBinding))
    errors.push(
      `latest trusted '${CANDIDATE_CHECK_NAME}' is not a successful exact run/attempt for ${commitSha}`,
    );
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
    integrationBinding,
    integrationArtifact,
    candidate,
    candidateBinding,
    artifact,
    errors,
  };
}

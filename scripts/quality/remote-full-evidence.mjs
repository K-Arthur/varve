/** Read-only adoption of existing exact-SHA integration and final candidate runs. */
import { classifyJobFailure } from '../ci-health.mjs';
import {
  validateLocalCandidateEvidence,
  verifyRemoteCertification,
} from '../release/certification.mjs';
import { expectedExecutionMatrices, REQUIRED_CI_JOBS } from './aggregate-ci.mjs';
import { readCertificationArtifact } from './certification-artifact.mjs';
import { browserLane } from './ci-execution-report.mjs';
import { validateCiPlan } from './ci-plan.mjs';
import {
  CI_CATEGORIES,
  CI_CATEGORY_LANES,
  POLICY_VERSION,
  promisedLanesForCategories,
  sha256,
} from './validation-policy.mjs';

export function githubReader(token, fetcher = fetch) {
  return async (path) => {
    let response;
    try {
      response = await fetcher(`https://api.github.com${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw Object.assign(new Error('GitHub metadata request timed out or could not connect'), {
        external: true,
      });
    }
    if (!response.ok)
      throw Object.assign(new Error(`GitHub metadata request failed (${response.status})`), {
        external: true,
      });
    return response.json();
  };
}

async function listPages(request, path, field) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const value = await request(
      `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    if (!Array.isArray(value[field])) throw new Error(`GitHub response is missing ${field}`);
    all.push(...value[field]);
    if (value[field].length < 100) return all;
  }
  throw new Error('Remote full-gate metadata exceeded the bounded pagination limit');
}

export function validateFullPlan(plan, identity, profile) {
  const errors = validateCiPlan(plan, {
    expectedHead: identity.commitSha,
    expectedPolicyHash: identity.policyHash,
  });
  const categories = Object.fromEntries(CI_CATEGORIES.map((name) => [name, true]));
  const expected = promisedLanesForCategories(categories, profile);
  if (
    plan?.profile !== profile ||
    plan?.treeSha !== identity.treeSha ||
    plan?.policyVersion !== POLICY_VERSION ||
    plan?.globalImpact !== true
  )
    errors.push('plan is not a full exact-tree certification profile');
  if (
    profile === 'candidate' &&
    (plan?.candidateMode !== 'final' || plan?.baseSha !== identity.commitSha)
  )
    errors.push('candidate plan is not frozen final mode');
  if (
    CI_CATEGORIES.some((name) => plan?.categories?.[name] !== true) ||
    JSON.stringify([...(plan?.selectedLanes ?? [])].sort()) !== JSON.stringify(expected) ||
    (plan?.deferredLanes ?? []).length ||
    plan?.e2eShardCount !== 8 ||
    JSON.stringify(plan?.e2eShards) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])
  )
    errors.push('plan omits a full-gate category, lane, or shard');
  const hash = sha256(
    JSON.stringify({
      commitSha: plan?.commitSha,
      baseSha: plan?.baseSha,
      fileHash: plan?.fileHash,
      categories: plan?.categories,
      selectedLanes: plan?.selectedLanes,
      candidateMode: plan?.candidateMode,
      policyHash: plan?.policyHash,
    }),
  );
  if (hash !== plan?.planHash || sha256((plan?.files ?? []).join('\0')) !== plan?.fileHash)
    errors.push('plan integrity hash mismatch');
  return errors;
}

function matrixExecutionErrors(entry, category, profile, runAttempt) {
  const expectedCount = category === 'e2e' ? 8 : ['rust', 'desktop'].includes(category) ? 3 : 1;
  const matrices = expectedExecutionMatrices(category, profile);
  if (
    !Array.isArray(entry?.reports) ||
    !Array.isArray(entry?.attempts) ||
    entry?.expectedCount !== expectedCount ||
    entry?.reports?.length !== expectedCount ||
    new Set(entry?.reports).size !== expectedCount ||
    entry?.attempts?.length !== expectedCount ||
    new Set(entry.attempts.map((attempt) => attempt?.cell)).size !== expectedCount ||
    entry.attempts.some(
      (attempt) =>
        !entry.reports.includes(attempt?.cell) ||
        !/^[1-9]\d*$/.test(String(attempt.attempt)) ||
        Number(attempt.attempt) > runAttempt,
    ) ||
    matrices?.some((matrix) => !entry.reports.includes(`${category}:${matrix}:single`)) ||
    (category === 'e2e' &&
      Array.from({ length: 8 }, (_, index) => index + 1).some(
        (shard) =>
          !entry.reports.some((cell) => typeof cell === 'string' && cell.endsWith(`:${shard}/8`)),
      ))
  )
    return [`incomplete ${category} execution matrix or producer attempts`];
  return [];
}

function compactBrowserReportValid(report, cells, lanes) {
  const stats = report?.stats;
  return (
    cells.includes(report?.cell) &&
    lanes.includes(report?.lane) &&
    /^[a-f0-9]{64}$/.test(report?.sha256 ?? '') &&
    /^[a-f0-9]{64}$/.test(report?.historySha256 ?? '') &&
    stats != null &&
    ['expected', 'unexpected', 'flaky', 'skipped'].every(
      (key) => Number.isSafeInteger(stats[key]) && stats[key] >= 0,
    ) &&
    stats.unexpected === 0 &&
    stats.flaky === 0 &&
    stats.expected + stats.skipped > 0
  );
}

function categoryExecutionErrors(entry, category) {
  const errors = [];
  const lanes = CI_CATEGORY_LANES[category];
  if (
    !Array.isArray(entry?.coveredLanes) ||
    lanes.some((lane) => !entry.coveredLanes.includes(lane))
  )
    errors.push(`incomplete ${category} owned lane coverage`);
  const browserLanes = lanes.filter(browserLane);
  if (!browserLanes.length) return errors;
  const reports = entry?.browserReports;
  const cells = entry?.reports;
  if (!Array.isArray(reports) || !Array.isArray(cells)) {
    errors.push(`missing ${category} compact browser evidence`);
    return errors;
  }
  if (reports.some((report) => !compactBrowserReportValid(report, cells, browserLanes)))
    errors.push(`invalid ${category} compact browser evidence`);
  // Multiple CPU/GPU reports may own the same cell/lane. Every required pair
  // must be present, and each contributing compact report must be clean.
  for (const cell of cells)
    for (const lane of browserLanes)
      if (!reports.some((report) => report?.cell === cell && report?.lane === lane))
        errors.push(`missing ${category} browser cell/lane evidence`);
  return errors;
}

export function validateFullAggregate(aggregate, plan, binding) {
  const errors = [];
  if (
    aggregate?.schema !== 1 ||
    aggregate?.profile !== plan.profile ||
    aggregate?.commitSha !== plan.commitSha ||
    aggregate?.policyHash !== plan.policyHash ||
    aggregate?.policyVersion !== POLICY_VERSION ||
    aggregate?.passed !== true ||
    aggregate?.certifiable !== true ||
    aggregate?.execution?.passed !== true ||
    aggregate?.execution?.deferred ||
    aggregate?.failures?.length ||
    aggregate?.deferredLanes?.length ||
    (plan.profile === 'candidate' && aggregate?.candidateMode !== 'final') ||
    JSON.stringify(aggregate?.selectedLanes) !== JSON.stringify(plan.selectedLanes)
  )
    errors.push('aggregate is not complete exact-source certification');
  const jobEvidence = Array.isArray(aggregate?.jobs) ? aggregate.jobs : [];
  const executionEvidence = Array.isArray(aggregate?.execution?.evidence)
    ? aggregate.execution.evidence
    : [];
  for (const [name, category] of Object.entries(REQUIRED_CI_JOBS)) {
    const jobs = jobEvidence.filter((job) => job?.job === name);
    const job = jobs[0];
    const skippedMetadata =
      name === 'attribution-check' &&
      plan.profile === 'integration' &&
      job?.deliberateSkip === true &&
      job?.status === 'skipped';
    if (
      jobs.length !== 1 ||
      !job?.acceptable ||
      (job.status !== 'success' && !skippedMetadata) ||
      (category !== null && job.selected !== true)
    )
      errors.push(`required job ${name} did not certify`);
  }
  for (const category of CI_CATEGORIES) {
    const entries = executionEvidence.filter((item) => item?.category === category);
    const entry = entries[0];
    if (entries.length !== 1) errors.push(`missing or duplicate ${category} execution evidence`);
    else {
      errors.push(...matrixExecutionErrors(entry, category, plan.profile, binding.runAttempt));
      errors.push(...categoryExecutionErrors(entry, category));
    }
  }
  const covered = new Set(
    executionEvidence.flatMap((entry) =>
      Array.isArray(entry?.coveredLanes) ? entry.coveredLanes : [],
    ),
  );
  for (const lane of plan.selectedLanes) {
    if (!covered.has(lane)) errors.push(`full-gate lane ${lane} has no execution evidence`);
  }
  return errors;
}

function planArtifact(artifacts, profile, identity, binding) {
  const prefix =
    profile === 'candidate'
      ? `varve-candidate-plan-${identity.commitSha}-${binding.runId}-attempt-`
      : `varve-ci-plan-${binding.runId}-attempt-`;
  const matches = artifacts
    .map((artifact) => ({ artifact, attempt: Number(artifact.name?.slice(prefix.length)) }))
    .filter(
      ({ artifact, attempt }) =>
        artifact.name?.startsWith(prefix) &&
        /^[1-9]\d*$/.test(artifact.name.slice(prefix.length)) &&
        Number.isSafeInteger(attempt) &&
        attempt > 0 &&
        attempt <= binding.runAttempt &&
        artifact.workflow_run?.id === binding.runId &&
        artifact.workflow_run?.head_sha === identity.commitSha,
    )
    .sort((a, b) => b.attempt - a.attempt);
  if (!matches.length || matches[1]?.attempt === matches[0].attempt)
    throw new Error(`missing or ambiguous immutable ${profile} plan artifact`);
  return matches[0].artifact;
}

async function classifyTerminalRun(run, request, repo) {
  const jobs = await listPages(
    request,
    `/repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
    'jobs',
  );
  const failures = [];
  for (const job of jobs.filter(
    (job) => job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped',
  )) {
    let annotations = [];
    if (!job.steps?.length && /\/check-runs\/[1-9]\d*$/.test(job.check_run_url ?? '')) {
      annotations = await request(
        `${new URL(job.check_run_url).pathname}/annotations?per_page=100`,
      );
    }
    failures.push({
      job: job.name,
      kind:
        classifyJobFailure(job, annotations) ??
        (job.conclusion === 'cancelled' ? 'cancelled-execution' : 'incomplete-execution'),
      conclusion: job.conclusion,
    });
  }
  const code = failures.some((failure) => failure.kind === 'real-failure');
  const external = failures.some((failure) =>
    ['billing-block', 'runner-unavailable', 'never-started'].includes(failure.kind),
  );
  return {
    status: code ? 1 : external ? 3 : 2,
    classification: code ? 'code-failure' : external ? 'external-blocked' : 'incomplete',
    failures,
  };
}

async function readProfileEvidence(
  profile,
  { certification, runs, identity, request, readArtifact, token, now },
) {
  const { repo } = identity;
  const binding =
    profile === 'candidate' ? certification.candidateBinding : certification.integrationBinding;
  const artifact =
    profile === 'candidate' ? certification.artifact : certification.integrationArtifact;
  if (binding?.runId !== runs[profile].id || binding.runAttempt !== runs[profile].attempt)
    throw new Error(`a newer ${profile} run superseded the selected certification`);
  const artifacts = await listPages(
    request,
    `/repos/${repo}/actions/runs/${binding.runId}/artifacts`,
    'artifacts',
  );
  const immutablePlan = planArtifact(artifacts, profile, identity, binding);
  const planRead = await readArtifact({
    repo,
    token,
    artifact: immutablePlan,
    names: ['ci-plan.json'],
    now,
  });
  const plan = planRead.documents['ci-plan.json'];
  const planErrors = validateFullPlan(plan, identity, profile);
  if (planErrors.length) throw new Error(planErrors.join('; '));
  const names =
    profile === 'candidate'
      ? ['candidate-certification.json', 'ci-certification.json']
      : ['ci-certification.json'];
  const summaryRead = await readArtifact({ repo, token, artifact, names, now });
  const aggregate = summaryRead.documents['ci-certification.json'];
  const errors = validateFullAggregate(aggregate, plan, binding);
  if (profile === 'candidate') {
    const candidate = summaryRead.documents['candidate-certification.json'];
    errors.push(...validateLocalCandidateEvidence(candidate, identity));
    const { evidenceHash, ...body } = candidate ?? {};
    if (
      candidate?.certifiable !== true ||
      String(candidate?.runId) !== String(binding.runId) ||
      sha256(JSON.stringify(body)) !== evidenceHash ||
      JSON.stringify(candidate?.selectedLanes) !== JSON.stringify(plan.selectedLanes) ||
      candidate?.deferredLanes?.length
    )
      errors.push('candidate evidence binding or integrity mismatch');
  }
  if (errors.length) throw new Error(errors.join('; '));
  return {
    binding,
    planHash: plan.planHash,
    full: true,
    plan: planRead,
    summary: summaryRead,
  };
}

async function recheckRemoteEvidence({
  repo,
  token,
  commitSha,
  policyHash,
  runs,
  evidence,
  request,
  verifyCertification,
}) {
  // A candidate check is published late in its workflow. An already-green
  // custom check cannot conceal a newer queued dispatch that has no check yet.
  for (const [profile, workflow] of [
    ['integration', 'ci.yml'],
    ['candidate', 'release-candidate.yml'],
  ]) {
    const currentRuns = await listPages(
      request,
      `/repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${commitSha}`,
      'workflow_runs',
    );
    const newest = currentRuns
      .filter(
        (run) =>
          run.head_sha === commitSha && run.path?.split('@')[0] === `.github/workflows/${workflow}`,
      )
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (
      newest?.id !== runs[profile].id ||
      newest.run_attempt !== runs[profile].attempt ||
      newest.status !== 'completed' ||
      newest.conclusion !== 'success'
    )
      return { status: 2, classification: 'superseded-during-verification', runs };
  }
  const current = await verifyCertification({
    repo,
    token,
    commitSha,
    policyHash,
    requireCandidate: true,
  });
  if (!current.ok)
    return { status: 1, classification: 'invalid-certification', errors: current.errors, runs };
  for (const profile of ['integration', 'candidate']) {
    const binding = profile === 'candidate' ? current.candidateBinding : current.integrationBinding;
    const artifact = profile === 'candidate' ? current.artifact : current.integrationArtifact;
    if (
      binding?.runId !== evidence[profile].binding.runId ||
      binding?.runAttempt !== evidence[profile].binding.runAttempt ||
      artifact?.id !== evidence[profile].summary.artifactId ||
      artifact?.digest !== evidence[profile].summary.digest
    )
      return { status: 2, classification: 'superseded-during-verification', runs };
  }
  const finalMaster = await request(`/repos/${repo}/git/ref/heads/master`);
  if (finalMaster.object?.sha !== commitSha)
    throw new Error('Accepted master changed during remote full-gate verification');
  return null;
}

export async function verifyRemoteFullEvidence({
  repo,
  token,
  commitSha,
  treeSha,
  policyHash,
  request = githubReader(token),
  verifyCertification = verifyRemoteCertification,
  readArtifact = readCertificationArtifact,
  now = Date.now(),
} = {}) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '') ||
    !/^[a-f0-9]{40}$/.test(commitSha ?? '') ||
    !/^[a-f0-9]{40}$/.test(treeSha ?? '') ||
    !/^[a-f0-9]{64}$/.test(policyHash ?? '') ||
    !token
  )
    throw new Error(
      'remote full gate requires repository, token, and exact source/policy identities',
    );
  const identity = { repo, commitSha, treeSha, policyHash };
  const master = await request(`/repos/${repo}/git/ref/heads/master`);
  if (master.object?.sha !== commitSha)
    throw new Error('candidate is not the accepted current master SHA');
  const runs = {};
  for (const [profile, workflow] of [
    ['integration', 'ci.yml'],
    ['candidate', 'release-candidate.yml'],
  ]) {
    const values = await listPages(
      request,
      `/repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${commitSha}`,
      'workflow_runs',
    );
    const exact = values.filter(
      (run) =>
        run.head_sha === commitSha && run.path?.split('@')[0] === `.github/workflows/${workflow}`,
    );
    if (
      exact.some(
        (run) =>
          !Number.isSafeInteger(run.id) ||
          run.id <= 0 ||
          !Number.isSafeInteger(run.run_attempt) ||
          run.run_attempt <= 0,
      )
    )
      throw new Error('Remote workflow identity is invalid');
    exact.sort((a, b) => Number(b.id) - Number(a.id));
    const run = exact[0];
    if (!run) return { status: 2, classification: 'missing-run', missing: profile, runs };
    runs[profile] = {
      id: run.id,
      attempt: run.run_attempt,
      status: run.status,
      conclusion: run.conclusion,
    };
    if (run.status !== 'completed') return { status: 2, classification: 'pending', runs };
    if (run.conclusion !== 'success')
      return { ...(await classifyTerminalRun(run, request, repo)), runs };
  }
  const certification = await verifyCertification({
    repo,
    token,
    commitSha,
    policyHash,
    requireCandidate: true,
  });
  if (!certification.ok)
    return {
      status: 1,
      classification: 'invalid-certification',
      errors: certification.errors,
      runs,
    };
  const evidence = {};
  for (const profile of ['integration', 'candidate']) {
    evidence[profile] = await readProfileEvidence(profile, {
      certification,
      runs,
      identity,
      request,
      readArtifact,
      token,
      now,
    });
  }
  const changed = await recheckRemoteEvidence({
    repo,
    token,
    commitSha,
    policyHash,
    runs,
    evidence,
    request,
    verifyCertification,
  });
  if (changed) return changed;
  return { status: 0, classification: 'remote-certified', identity, runs, evidence };
}

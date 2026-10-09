#!/usr/bin/env node

/** Require complete exact-SHA integration evidence before candidate adoption. */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  validateAdoptionPlanPair,
  validateFullPlan,
  verifyRemoteIntegrationEvidence,
} from '../quality/remote-full-evidence.mjs';
import { POLICY_VERSION } from '../quality/validation-policy.mjs';

function value(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 ? null : (args[index + 1] ?? null);
}

export async function verifyCandidateIntegration({
  planPath = value(process.argv.slice(2), '--plan') ?? 'ci-plan.json',
  outputPath = value(process.argv.slice(2), '--output') ?? 'candidate-integration-adoption.json',
  environment = process.env,
  verify = verifyRemoteIntegrationEvidence,
} = {}) {
  const candidatePlan = JSON.parse(readFileSync(planPath, 'utf8'));
  const identity = {
    repo: environment.GITHUB_REPOSITORY,
    token: environment.GITHUB_TOKEN ?? environment.GH_TOKEN,
    commitSha: environment.EXPECTED_SHA,
    treeSha: environment.EXPECTED_TREE_SHA,
    policyHash: environment.EXPECTED_POLICY_HASH,
  };
  if (candidatePlan.commitSha !== identity.commitSha)
    throw new Error('candidate plan does not match the requested exact SHA');
  if (candidatePlan.treeSha !== identity.treeSha)
    throw new Error('candidate plan does not match the requested source tree');
  if (
    candidatePlan.policyHash !== identity.policyHash ||
    candidatePlan.policyVersion !== POLICY_VERSION
  )
    throw new Error('candidate plan does not match the current validation policy');
  const candidateErrors = validateFullPlan(candidatePlan, identity, 'candidate');
  if (candidateErrors.length)
    throw new Error(`candidate plan is not the full final profile: ${candidateErrors.join('; ')}`);

  const result = await verify(identity);
  if (result.status !== 0) {
    const details =
      result.errors?.join('; ') || result.classification || 'integration evidence is incomplete';
    throw new Error(
      `full integration evidence cannot be adopted: ${details}. Recovery: run or rerun the full CI workflow for this exact master SHA, wait for CI / certification to pass, then dispatch the final candidate again.`,
    );
  }
  const integration = result.evidence?.integration;
  const integrationPlan = integration?.plan?.documents?.['ci-plan.json'];
  const pairErrors = validateAdoptionPlanPair(integrationPlan, candidatePlan, identity);
  if (pairErrors.length)
    throw new Error(
      `full integration evidence is not equivalent to this candidate: ${pairErrors.join('; ')}`,
    );

  const adoption = {
    commitSha: identity.commitSha,
    treeSha: identity.treeSha,
    policyVersion: POLICY_VERSION,
    policyHash: identity.policyHash,
    planHash: candidatePlan.planHash,
    integrationEvidence: {
      commitSha: integration.commitSha,
      treeSha: integration.treeSha,
      policyVersion: integration.policyVersion,
      policyHash: integration.policyHash,
      planHash: integration.planHash,
      binding: {
        runId: integration.binding.runId,
        runAttempt: integration.binding.runAttempt,
      },
      plan: {
        artifactId: integration.plan.artifactId,
        digest: integration.plan.digest,
      },
      summary: {
        artifactId: integration.summary.artifactId,
        digest: integration.summary.digest,
      },
    },
  };
  const serialized = JSON.stringify(adoption);
  writeFileSync(outputPath, `${JSON.stringify(adoption, null, 2)}\n`);
  if (environment.GITHUB_OUTPUT)
    appendFileSync(environment.GITHUB_OUTPUT, `adoption_json=${serialized}\n`);
  return adoption;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyCandidateIntegration()
    .then((adoption) =>
      console.log(
        `Full integration verified for ${adoption.commitSha}; reusing run ${adoption.integrationEvidence.binding.runId} attempt ${adoption.integrationEvidence.binding.runAttempt}.`,
      ),
    )
    .catch((error) => {
      console.error(`Candidate integration preflight failed: ${error.message}`);
      process.exitCode = 1;
    });
}

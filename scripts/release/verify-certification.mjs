#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { computePolicyHash, POLICY_VERSION } from '../quality/validation-policy.mjs';
import { verifyRemoteCertification } from './certification.mjs';

function parseArgs(args) {
  const flags = {
    sha: process.env.GITHUB_SHA,
    repo: process.env.GITHUB_REPOSITORY,
    integrationOnly: args.includes('--integration-only'),
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--sha') flags.sha = args[++i];
    else if (args[i] === '--repo') flags.repo = args[++i];
    else if (args[i] === '--policy-hash') flags.policyHash = args[++i];
  }
  return flags;
}

export async function verifyCertification(flags = parseArgs(process.argv.slice(2))) {
  const policyHash = flags.policyHash ?? computePolicyHash();
  const result = await verifyRemoteCertification({
    repo: flags.repo,
    commitSha: flags.sha,
    policyHash,
    requireCandidate: !flags.integrationOnly,
  });
  if (!result.ok) {
    const recovery = flags.integrationOnly
      ? 'run the integration CI workflow for the exact SHA and wait for CI / certification'
      : `run Release Candidate certification for the exact tag SHA with policy ${POLICY_VERSION}`;
    throw new Error(
      `${result.errors.join('; ')}. Recovery: ${recovery}, then retry; do not retag another commit.`,
    );
  }
  console.log(`Exact-SHA certification verified for ${flags.sha} (policy ${policyHash}).`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyCertification().catch((error) => {
    console.error(`Release certification preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { parseArgs };

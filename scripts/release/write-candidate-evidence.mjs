#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildCandidateEvidence } from './certification.mjs';

function value(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const plan = JSON.parse(readFileSync(value(args, '--plan') ?? 'ci-plan.json', 'utf8'));
  const aggregate = JSON.parse(
    readFileSync(value(args, '--aggregate') ?? 'ci-certification.json', 'utf8'),
  );
  const evidence = buildCandidateEvidence({
    commitSha: plan.commitSha,
    policyHash: plan.policyHash,
    aggregate,
  });
  const output = value(args, '--output') ?? 'candidate-certification.json';
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`${evidence.status}: ${output} (${evidence.commitSha}, ${evidence.policyHash})`);
  if (evidence.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`candidate evidence failed: ${error.message}`);
    process.exitCode = 1;
  }
}

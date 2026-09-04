#!/usr/bin/env node

/** Stable-check and canonical category consumer regression tests. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregateCertification, REQUIRED_CI_JOBS } from './aggregate-ci.mjs';
import {
  CI_CATEGORIES,
  CI_CATEGORY_LANES,
  promisedLanesForCategories,
} from './validation-policy.mjs';

const allCategories = Object.fromEntries(CI_CATEGORIES.map((category) => [category, true]));
const allSuccess = Object.fromEntries(
  Object.keys(REQUIRED_CI_JOBS).map((job) => [job, { result: 'success' }]),
);

const passed = aggregateCertification({
  needs: { ...allSuccess, 'attribution-check': { result: 'skipped' } },
  categories: allCategories,
  selectedLanes: promisedLanesForCategories(allCategories),
  commitSha: 'a'.repeat(40),
  policyVersion: 'policy-test',
  policyHash: 'b'.repeat(64),
});
assert.equal(passed.passed, true, 'all selected jobs plus deliberate attribution skip pass');
assert.equal(passed.commitSha, 'a'.repeat(40));
assert.equal(passed.policyHash, 'b'.repeat(64));

const deliberateSkips = aggregateCertification({
  needs: Object.fromEntries(
    Object.keys(REQUIRED_CI_JOBS).map((job) => [
      job,
      { result: job === 'changes' || job === 'pipeline-validate' ? 'success' : 'skipped' },
    ]),
  ),
  categories: {
    pipeline: true,
    js: false,
    rust: false,
    wasm: false,
    website: false,
    e2e: false,
    visual: false,
    desktop: false,
    models: false,
    bench: false,
  },
});
assert.equal(deliberateSkips.passed, true, 'unselected dynamic jobs may be deliberately skipped');

for (const result of ['failure', 'cancelled', 'timed_out']) {
  const needs = { ...allSuccess, js: { result } };
  const failure = aggregateCertification({ needs, categories: allCategories });
  assert.equal(failure.passed, false, `${result} selected job blocks certification`);
  assert.ok(failure.failures.some((entry) => entry.job === 'js'));
}
const selectedSkip = aggregateCertification({
  needs: { ...allSuccess, e2e: { result: 'skipped' } },
  categories: { ...allCategories },
});
assert.equal(selectedSkip.passed, false, 'selected skip is not a green result');
const missing = aggregateCertification({
  needs: { changes: { result: 'success' } },
  categories: allCategories,
});
assert.equal(missing.passed, false, 'missing required evidence blocks certification');

// Visual-only impact launches the visual consumer while the functional browser
// corpus remains a deliberate skip.
const visualOnly = aggregateCertification({
  needs: { ...allSuccess, e2e: { result: 'skipped' } },
  categories: {
    pipeline: true,
    js: false,
    rust: true,
    wasm: false,
    website: false,
    e2e: false,
    visual: true,
    desktop: false,
    models: false,
    bench: false,
  },
});
assert.equal(visualOnly.passed, true, 'visual-only plans may skip functional e2e');
const visualSelectedSkip = aggregateCertification({
  needs: { ...allSuccess, 'e2e-visual': { result: 'skipped' } },
  categories: {
    pipeline: true,
    js: false,
    rust: false,
    wasm: false,
    website: false,
    e2e: false,
    visual: true,
    desktop: false,
    models: false,
    bench: false,
  },
});
assert.equal(
  visualSelectedSkip.passed,
  false,
  'a selected visual consumer cannot be silently skipped',
);

// Every category has at least one concrete workflow consumer, and the stable
// aggregator names every possible job. This catches the old failure mode where
// a newly added category was selected by policy but never ran in CI.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const candidate = readFileSync('.github/workflows/release-candidate.yml', 'utf8');
const consumers = {
  pipeline: ['changes', 'pipeline-validate'],
  js: ['js:'],
  rust: ['rust:'],
  wasm: ['wasm:'],
  website: ['website-e2e'],
  e2e: ['e2e:'],
  visual: ['e2e-visual'],
  desktop: ['desktop-e2e'],
  models: ['models:'],
  bench: ['bench:'],
};
for (const category of CI_CATEGORIES) {
  assert.ok(CI_CATEGORY_LANES[category]?.length, `${category} has canonical lane mapping`);
  for (const marker of consumers[category]) {
    assert.ok(
      ci.includes(marker) || candidate.includes(marker),
      `${category} consumer ${marker} missing`,
    );
  }
}
const dynamicConditions = {
  js: 'outputs.js',
  rust: 'outputs.rust',
  wasm: 'outputs.wasm',
  website: 'outputs.website',
  e2e: 'outputs.e2e',
  visual: 'outputs.visual',
  desktop: 'outputs.desktop',
  models: 'outputs.models',
  bench: 'outputs.bench',
};
for (const [category, output] of Object.entries(dynamicConditions)) {
  assert.match(ci, new RegExp(`${output} == 'true'`), `${category} lacks a canonical selector`);
  assert.match(ci, /outputs\.full == 'true'/, `${category} lacks the full-profile selector`);
}
assert.match(ci, /name: CI \/ certification/);
assert.match(ci, /if: \$\{\{ always\(\) \}\}/);
assert.match(candidate, /- run: pnpm lint/, 'candidate full JS profile must execute lint');
for (const job of Object.keys(REQUIRED_CI_JOBS))
  assert.match(ci, new RegExp(`- ${job}(?:\n|\r)`), `${job} missing from CI aggregation needs`);

console.log('aggregate CI tests passed');

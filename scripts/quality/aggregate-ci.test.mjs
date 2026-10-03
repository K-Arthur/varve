#!/usr/bin/env node

/** Stable-check and canonical category consumer regression tests. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import {
  aggregateCertification,
  expectedExecutionMatrices,
  REQUIRED_CI_JOBS,
  validateExecutionEvidence,
} from './aggregate-ci.mjs';
import { browserCaseId, createBrowserInventory } from './browser-inventory.mjs';
import {
  CI_CATEGORIES,
  CI_CATEGORY_LANES,
  FULL_BROWSER_SHARDS,
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
assert.equal(passed.certifiable, true, 'integration evidence is certifiable');

const strictPlan = {
  profile: 'integration',
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
  selectedLanes: ['pipeline-validate', 'ci-tools', 'policy'],
  commitSha: 'c'.repeat(40),
  treeSha: 'd'.repeat(40),
  planHash: 'e'.repeat(64),
  policyHash: 'f'.repeat(64),
  e2eShardCount: 1,
};
const pipelineExecution = {
  schema: 1,
  category: 'pipeline',
  profile: 'integration',
  candidateMode: null,
  status: 'success',
  source: {
    commitSha: strictPlan.commitSha,
    treeSha: strictPlan.treeSha,
    plannedCommitSha: strictPlan.commitSha,
    plannedTreeSha: strictPlan.treeSha,
    planHash: strictPlan.planHash,
    policyHash: strictPlan.policyHash,
  },
  workflow: { repository: 'K-Arthur/varve', runId: '42', runAttempt: '1' },
  matrix: 'ubuntu-latest',
  shard: null,
  executedLanes: ['pipeline-validate', 'ci-tools', 'policy'],
};
const strictNeeds = Object.fromEntries(
  Object.keys(REQUIRED_CI_JOBS).map((job) => [
    job,
    { result: job === 'changes' || job === 'pipeline-validate' ? 'success' : 'skipped' },
  ]),
);
const strictPassed = aggregateCertification({
  needs: strictNeeds,
  ...strictPlan,
  executionReports: [pipelineExecution],
  workflow: { repository: 'K-Arthur/varve', runId: '42' },
});
assert.equal(strictPassed.passed, true, 'exact successful execution evidence certifies the plan');
assert.equal(strictPassed.execution.deferred, undefined);
assert.equal(
  validateExecutionEvidence({
    reports: [{ ...pipelineExecution, source: { ...pipelineExecution.source, clean: false } }],
    plan: strictPlan,
  }).passed,
  false,
  'dirty-source execution cannot certify a release',
);

const attemptWorkflow = { repository: 'K-Arthur/varve', runId: '42', runAttempt: '2' };
const retryReport = (attempt, status = 'success') => ({
  ...pipelineExecution,
  status,
  workflow: { ...pipelineExecution.workflow, runAttempt: String(attempt) },
});
const retryEvidence = (reports) =>
  validateExecutionEvidence({ reports, plan: strictPlan, workflow: attemptWorkflow });
assert.equal(
  retryEvidence([retryReport(1, 'failure'), retryReport(2)]).passed,
  true,
  'a successful retry supersedes its failed receipt without deleting failure evidence',
);
assert.equal(
  retryEvidence([retryReport(1), retryReport(2, 'failure')]).passed,
  false,
  'a newer failure cannot fall back to an earlier green receipt',
);
assert.equal(retryEvidence([retryReport(1)]).passed, true, 'an unchanged green job is retained');
assert.equal(
  retryEvidence([retryReport(2), retryReport(2)]).passed,
  false,
  'duplicate retry blocks',
);
for (const attempt of ['', '0', '-1', '1.5', '3', 'NaN', '2x']) {
  assert.equal(
    retryEvidence([retryReport(attempt)]).passed,
    false,
    `invalid/future attempt ${attempt}`,
  );
}
assert.equal(
  retryEvidence([
    retryReport(1),
    { ...retryReport(2), source: { ...pipelineExecution.source, commitSha: '0'.repeat(40) } },
  ]).passed,
  false,
  'a retry from another source cannot fall back to the original pass',
);
assert.equal(
  retryEvidence([
    retryReport(1),
    { ...retryReport(2), workflow: { ...attemptWorkflow, runId: 'other' } },
  ]).passed,
  false,
  'a receipt from another run is not a superseding retry',
);
assert.equal(
  retryEvidence([retryReport(1), { schema: null, invalidPath: 'corrupt.json' }]).passed,
  false,
  'a corrupt downloaded receipt cannot be silently ignored',
);
const missingExecution = aggregateCertification({
  needs: strictNeeds,
  ...strictPlan,
  executionReports: [],
});
assert.equal(missingExecution.passed, false, 'missing execution evidence blocks certification');
const wrongTree = validateExecutionEvidence({
  reports: [
    { ...pipelineExecution, source: { ...pipelineExecution.source, treeSha: '0'.repeat(40) } },
  ],
  plan: strictPlan,
});
assert.equal(wrongTree.passed, false, 'a report from another tree cannot certify the plan');
const e2ePlan = {
  ...strictPlan,
  categories: { ...strictPlan.categories, pipeline: false, e2e: true },
  selectedLanes: ['e2e:all'],
  e2eShardCount: FULL_BROWSER_SHARDS,
};
const rustPlan = {
  ...strictPlan,
  categories: { ...strictPlan.categories, rust: true },
  selectedLanes: [...strictPlan.selectedLanes, 'rust-test:all', 'rust-clippy:all', 'cargo-fmt'],
};
const rustReports = ['ubuntu-latest', 'macos-latest', 'windows-latest'].map((matrix) => ({
  ...pipelineExecution,
  category: 'rust',
  matrix,
  executedLanes: ['rust-test:all', 'rust-clippy:all', 'cargo-fmt'],
}));
assert.equal(
  validateExecutionEvidence({ reports: [pipelineExecution, ...rustReports], plan: rustPlan })
    .passed,
  true,
  'every promised Rust platform is accepted',
);
assert.equal(
  validateExecutionEvidence({
    reports: [
      pipelineExecution,
      ...rustReports.map((report, i) => ({ ...report, matrix: `fake-${i}` })),
    ],
    plan: rustPlan,
  }).passed,
  false,
  'three arbitrary matrix labels cannot replace the promised platforms',
);
assert.equal(
  validateExecutionEvidence({
    reports: [
      pipelineExecution,
      ...rustReports.map((report, i) =>
        i === 0 ? { ...report, executedLanes: ['cargo-fmt'] } : report,
      ),
    ],
    plan: rustPlan,
  }).passed,
  false,
  'every platform must execute its promised lanes independently',
);
const allBrowserCases = Array.from({ length: FULL_BROWSER_SHARDS }, (_, index) => index + 1).map(
  (index) => ({
    file: `fixture-${index}.spec.ts`,
    titlePath: [`fixture-${index}.spec.ts`, 'moves selected objects'],
    project: 'chromium',
    caseId: browserCaseId(
      `fixture-${index}.spec.ts`,
      [`fixture-${index}.spec.ts`, 'moves selected objects'],
      'chromium',
    ),
    status: 'expected',
    expectedStatus: 'passed',
    annotations: [],
    attempts: [{ retry: 0, status: 'passed' }],
  }),
);
const browserCases = allBrowserCases.slice(0, 1);
const inventory = createBrowserInventory(
  {
    errors: [],
    config: { projects: [{ name: 'chromium' }] },
    suites: allBrowserCases.map((entry) => ({
      title: entry.file,
      specs: [
        {
          file: entry.file,
          title: entry.titlePath[1],
          tests: [{ projectName: 'chromium', expectedStatus: 'passed' }],
        },
      ],
    })),
  },
  {
    lane: 'e2e:all',
    argv: ['pnpm', 'exec', 'playwright', 'test', '--project=chromium'],
    source: strictPlan,
  },
);
const browserEvidence = {
  schema: 1,
  errors: [],
  reports: [
    {
      lane: 'e2e:all',
      sha256: 'c'.repeat(64),
      historySha256: createHash('sha256').update(JSON.stringify(browserCases)).digest('hex'),
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      runner: {
        workers: 1,
        updateSnapshots: 'none',
        failOnFlakyTests: true,
        trace: 'retain-on-failure',
        projects: [{ retries: 0 }],
      },
      globalErrorCount: 0,
      cases: browserCases,
      inventory,
      shard: `1/${FULL_BROWSER_SHARDS}`,
    },
  ],
};
const e2eReports = Array.from({ length: FULL_BROWSER_SHARDS }, (_, index) => index + 1).map(
  (shard) => ({
    ...pipelineExecution,
    category: 'e2e',
    playwright: {
      ...browserEvidence,
      reports: browserEvidence.reports.map((report) => ({
        ...report,
        cases: allBrowserCases.slice(shard - 1, shard),
        shard: `${shard}/${FULL_BROWSER_SHARDS}`,
        historySha256: createHash('sha256')
          .update(JSON.stringify(allBrowserCases.slice(shard - 1, shard)))
          .digest('hex'),
      })),
    },
    source: pipelineExecution.source,
    matrix: 'ubuntu-latest',
    shard: `${shard}/${FULL_BROWSER_SHARDS}`,
    executedLanes: ['e2e:all'],
  }),
);
assert.equal(
  validateExecutionEvidence({ reports: [pipelineExecution, ...e2eReports], plan: e2ePlan }).passed,
  true,
  'all promised browser shards are required and accepted',
);
const repeatedShard = structuredClone(e2eReports);
repeatedShard[1].playwright.reports[0] = {
  ...repeatedShard[0].playwright.reports[0],
  shard: `2/${FULL_BROWSER_SHARDS}`,
};
assert.equal(
  validateExecutionEvidence({ reports: [pipelineExecution, ...repeatedShard], plan: e2ePlan })
    .passed,
  false,
  'distinct shard slots cannot conceal the same repeated case and omitted case',
);
const missingInventory = structuredClone(e2eReports);
delete missingInventory[0].playwright.reports[0].inventory;
assert.equal(
  validateExecutionEvidence({ reports: [pipelineExecution, ...missingInventory], plan: e2ePlan })
    .passed,
  false,
  'old green receipts without a discovered inventory fail closed',
);
assert.equal(
  validateExecutionEvidence({
    reports: [pipelineExecution, ...e2eReports.slice(0, 1)],
    plan: e2ePlan,
  }).passed,
  false,
  'a missing browser shard is incomplete evidence',
);

const triage = aggregateCertification({
  needs: { ...allSuccess, js: { result: 'failure' } },
  categories: allCategories,
  profile: 'candidate',
  candidateMode: 'triage',
});
assert.equal(triage.passed, false, 'triage still reports lane failures');
assert.equal(triage.certifiable, false, 'triage evidence is never certifiable');

assert.throws(
  () => aggregateCertification({ profile: 'candidate' }),
  /candidate aggregation requires mode/,
  'candidate aggregation requires an explicit mode',
);

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

// Keep native tooling checks on every selected OS, but don't repeat shared JS
// gates in the platform matrix. The CI and candidate jobs own those gates once
// on Linux; this matrix adds host-specific Rust and Tauri evidence.
const nativeBuild = load(readFileSync('.github/workflows/build.yml', 'utf8')).jobs.build;
const nativeSteps = nativeBuild.steps;
const installIndex = nativeSteps.findIndex((step) => step.name === 'Install JS dependencies');
const toolsIndex = nativeSteps.findIndex((step) => step.run === 'pnpm test:ci:tools');
assert.ok(toolsIndex > installIndex, 'native tooling preflight follows frozen dependency install');
assert.equal(nativeSteps[toolsIndex].if, undefined, 'tooling runs on every selected native OS');
assert.equal(
  nativeSteps[toolsIndex]['continue-on-error'],
  undefined,
  'tooling failure blocks build',
);
for (const name of ['Lint (Rust)', 'Rust tests', 'Tauri build (release, no bundle)']) {
  const index = nativeSteps.findIndex((step) => step.name === name);
  assert.ok(index > toolsIndex, `${name} must follow native tooling preflight`);
}
for (const name of ['Typecheck', 'Lint (JS)', 'JS tests', 'Token gate', 'Emoji gate']) {
  assert.equal(
    nativeSteps.some((step) => step.name === name),
    false,
    `${name} is shared source validation and must not repeat per native OS`,
  );
}
for (const file of ['.github/workflows/ci.yml', '.github/workflows/release-candidate.yml']) {
  assert.ok(load(readFileSync(file, 'utf8')).jobs.js, `${file} owns shared JS validation`);
}
assert.equal(
  JSON.parse(readFileSync('package.json', 'utf8')).scripts.test,
  'pnpm test:ci:tools && vitest run',
  'splitting native workflow steps must preserve the complete pnpm test contract',
);

// Every category has at least one concrete workflow consumer, and the stable
// aggregator names every possible job. This catches the old failure mode where
// a newly added category was selected by policy but never ran in CI.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const candidate = readFileSync('.github/workflows/release-candidate.yml', 'utf8');
for (const workflowText of [ci, candidate]) {
  const workflow = load(workflowText);
  const profile = workflowText === candidate ? 'candidate' : 'integration';
  assert.deepEqual(
    workflow.jobs.rust.strategy.matrix.os,
    expectedExecutionMatrices('rust', profile),
  );
  assert.deepEqual(
    workflow.jobs['desktop-e2e'].strategy.matrix.include.map((cell) => cell.name),
    expectedExecutionMatrices('desktop', profile),
  );
  const names = new Set();
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (!step.uses?.startsWith('actions/upload-artifact@')) continue;
      const template = step.with?.name;
      assert.ok(
        template.includes('github.run_attempt'),
        `${jobId}: upload must preserve each attempt`,
      );
      assert.ok(template.includes('github.run_id'), `${jobId}: upload must identify the run`);
      const matrix = job.strategy?.matrix;
      const cells =
        matrix?.include ??
        (matrix?.os ? matrix.os.map((os) => ({ os })) : [{ shard: 1 }, { shard: 2 }]);
      for (const attempt of [1, 2]) {
        for (const cell of cells) {
          const name = template.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => {
            if (expression === 'github.run_attempt') return String(attempt);
            if (expression === 'github.run_id') return '123';
            if (expression.startsWith('matrix.')) return String(cell[expression.slice(7)]);
            return expression;
          });
          // Non-matrix jobs have one writer, irrespective of shard fixtures.
          if (!matrix && cell.shard === 2) continue;
          assert.ok(!names.has(name), `${jobId}: immutable upload conflict ${name}`);
          names.add(name);
        }
      }
    }
  }
  const planProducer = workflow.jobs.changes;
  assert.match(
    planProducer.outputs.plan_artifact_id,
    /^\$\{\{ steps\.upload-plan\.outputs\.artifact-id \}\}$/,
  );
  assert.match(
    workflow.jobs.wasm.outputs.artifact_id,
    /^\$\{\{ steps\.upload-wasm\.outputs\.artifact-id \}\}$/,
  );
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (!step.uses?.startsWith('actions/download-artifact@')) continue;
      assert.match(step.with['github-token'], /^\$\{\{ github\.token \}\}$/);
      assert.match(step.with['run-id'], /^\$\{\{ github\.run_id \}\}$/);
      if (step.name?.includes('execution receipts'))
        assert.equal(
          step.with['merge-multiple'],
          false,
          'receipt downloads retain attempt directories',
        );
      else
        assert.ok(
          step.with['artifact-ids'],
          'producer downloads use the retained immutable artifact ID',
        );
    }
  }
}
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
assert.match(
  candidate,
  /Verify prior exact-SHA integration certification\n\s+if: \$\{\{ inputs\.mode == 'final' \}\}/,
  'triage does not inherit the final integration prerequisite',
);
assert.match(candidate, /candidateMode|--mode "\$\{\{ inputs\.mode \}\}"/);
assert.match(candidate, /CONCLUSION=neutral/);
assert.match(candidate, /-f external_id="\$\{GITHUB_RUN_ID\}:\$\{GITHUB_RUN_ATTEMPT\}"/);
assert.match(
  candidate,
  /-f details_url="\$\{GITHUB_SERVER_URL\}\/\$\{REPOSITORY\}\/actions\/runs\/\$\{GITHUB_RUN_ID\}"/,
  'candidate API checks expose the explicit run URL required by certification binding',
);
for (const job of Object.keys(REQUIRED_CI_JOBS))
  assert.match(ci, new RegExp(`- ${job}(?:\n|\r)`), `${job} missing from CI aggregation needs`);

console.log('aggregate CI tests passed');

for (const badEvidence of [
  null,
  { ...browserEvidence, errors: ['flaky case'] },
  {
    ...browserEvidence,
    reports: [
      {
        ...browserEvidence.reports[0],
        stats: { expected: 0, unexpected: 0, flaky: 1, skipped: 0 },
      },
    ],
  },
]) {
  assert.equal(
    validateExecutionEvidence({
      reports: [
        pipelineExecution,
        ...e2eReports.map((report) => ({ ...report, playwright: badEvidence })),
      ],
      plan: e2ePlan,
    }).passed,
    false,
    'consumer rejects a green receipt with missing or contradictory browser history',
  );
}
const compactBrowserSummary = validateExecutionEvidence({
  reports: [pipelineExecution, ...e2eReports],
  plan: e2ePlan,
}).evidence.find((item) => item.category === 'e2e');
assert.equal(compactBrowserSummary.browserReports.length, FULL_BROWSER_SHARDS);
assert.ok(
  compactBrowserSummary.browserReports.every(
    (report) => report.historySha256 && report.stats.expected === 1,
  ),
);
assert.ok(
  compactBrowserSummary.browserReports.every((report) => !Object.hasOwn(report, 'cases')),
  'final summary must not duplicate per-case histories',
);
console.log('aggregate browser evidence and bounded history summary tests passed');

#!/usr/bin/env node

/** Regression tests for selected integration lane execution. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandsForCategory, runCategory, runCategoryDetailed } from './ci-run-lanes.mjs';

const plan = {
  profile: 'integration',
  files: ['packages/ui/src/components/Select.tsx', 'tests/e2e/canvas/tools.spec.ts'],
  selectedLanes: ['e2e:canvas', 'js-unit:@varve/ui', 'typecheck:@varve/ui', 'pipeline-validate'],
};

const js = commandsForCategory(plan, 'js');
assert.deepEqual(js.map((entry) => entry.lane).sort(), [
  'js-unit:@varve/ui',
  'typecheck:@varve/ui',
]);
assert.ok(js.every((entry) => Array.isArray(entry.argv)));
assert.ok(js.every((entry) => !entry.argv.includes('sh')));

const e2e = commandsForCategory(plan, 'e2e');
assert.ok(e2e.some((entry) => entry.argv.includes('tests/e2e/canvas')));
assert.ok(e2e.every((entry) => !entry.argv.includes('sh')));

const strictFlags = [
  '--workers=1',
  '--retries=0',
  '--update-snapshots=none',
  '--fail-on-flaky-tests',
  '--trace=retain-on-failure',
];
for (const lane of ['e2e:all', 'e2e:canvas', 'e2e:file:tests/e2e/canvas/tools.spec.ts']) {
  const [command] = commandsForCategory({ ...plan, selectedLanes: [lane] }, 'e2e');
  for (const flag of strictFlags) assert.ok(command.argv.includes(flag), `${lane}: ${flag}`);
}
const website = commandsForCategory(
  { ...plan, selectedLanes: ['website-unit', 'website-e2e'] },
  'website',
);
assert.deepEqual(website[0].argv, ['pnpm', 'test:website']);
for (const flag of strictFlags) assert.ok(website[1].argv.includes(flag));
assert.equal(
  runCategory(plan, 'e2e', {
    execute: (argv) => {
      for (const flag of strictFlags) assert.ok(argv.includes(flag));
      return 1;
    },
  }),
  1,
  'a first-attempt browser failure remains blocking rather than a success receipt',
);

const executed = [];
assert.equal(
  runCategory(plan, 'js', {
    execute: (argv) => {
      executed.push(argv);
      return 0;
    },
  }),
  0,
);
assert.equal(executed.length, 2);

assert.equal(
  runCategory(plan, 'js', { execute: () => 1 }),
  1,
  'a selected integration lane failure remains blocking',
);

const globalPlan = {
  ...plan,
  globalImpact: true,
  selectedLanes: ['js-unit:all', 'lint:all', 'pipeline-validate', 'typecheck:all'],
};
assert.deepEqual(
  commandsForCategory(globalPlan, 'js')
    .map((entry) => entry.lane)
    .sort(),
  ['js-unit:all', 'lint:all', 'typecheck:all'],
);

// The executable runner must not consume a plan generated for another commit
// or policy revision, even when the selected command itself is valid.
const identityFixtureDir = mkdtempSync(join(tmpdir(), 'varve-ci-lane-identity-'));
try {
  const invalidPlan = {
    schema: 1,
    profile: 'integration',
    commitSha: 'a'.repeat(40),
    policyHash: 'b'.repeat(64),
    categories: {
      pipeline: true,
      js: true,
      rust: false,
      wasm: false,
      website: false,
      e2e: false,
      visual: false,
      desktop: false,
      models: false,
      bench: false,
    },
    selectedLanes: ['js-unit:all'],
  };
  const invalidPath = join(identityFixtureDir, 'ci-plan.json');
  writeFileSync(invalidPath, `${JSON.stringify(invalidPlan)}\n`);
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'scripts/quality/ci-run-lanes.mjs',
          '--plan',
          invalidPath,
          '--category',
          'js',
          '--dry-run',
        ],
        { encoding: 'utf8' },
      ),
    /identity check failed/,
  );
} finally {
  rmSync(identityFixtureDir, { recursive: true, force: true });
}

console.log('ci-run-lanes tests passed');

const browserJson = {
  config: {
    workers: 1,
    updateSnapshots: 'none',
    failOnFlakyTests: true,
    argv: ['--trace=retain-on-failure'],
    projects: [{ name: 'chromium', retries: 0 }],
  },
  errors: [],
  stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  suites: [
    {
      title: 'fixture.spec.ts',
      file: 'fixture.spec.ts',
      specs: [
        {
          id: 'playwright-source-id',
          file: 'fixture.spec.ts',
          title: 'keeps failure evidence',
          line: 7,
          tests: [
            {
              projectName: 'chromium',
              expectedStatus: 'passed',
              status: 'expected',
              results: [
                {
                  status: 'passed',
                  retry: 0,
                  duration: 10,
                  errors: [],
                  startTime: '2026-10-02T00:00:00Z',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
// Exit-code drift cannot produce a success receipt when JSON contradicts it.
const browserLaneDirectory = mkdtempSync(join(tmpdir(), 'varve-ci-lane-browser-'));
try {
  const runBrowser = (name, json, exitCode = 0) =>
    runCategoryDetailed(plan, 'e2e', {
      browserReportDir: join(browserLaneDirectory, name),
      execute: (_argv, { browserReportPath }) => {
        if (json) writeFileSync(browserReportPath, JSON.stringify(json));
        return exitCode;
      },
    });
  assert.equal(runBrowser('pass', browserJson).status, 0);
  const flaky = structuredClone(browserJson);
  flaky.stats.expected = 0;
  flaky.stats.flaky = 1;
  flaky.suites[0].specs[0].tests[0].status = 'flaky';
  const rejected = runBrowser('flaky-exit-zero', flaky);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.outcomes[0].exitCode, 0, 'preserve original command exit code');
  assert.equal(rejected.outcomes[0].status, 'failure', 'reject contradictory producer output');
  assert.equal(runBrowser('missing-exit-zero', null).status, 1);
  assert.equal(runBrowser('command-exit-failed', browserJson, 7).status, 7);
} finally {
  rmSync(browserLaneDirectory, { recursive: true, force: true });
}
console.log('CI lane actual browser report guards passed');

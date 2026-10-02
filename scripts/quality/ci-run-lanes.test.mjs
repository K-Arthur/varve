#!/usr/bin/env node

/** Regression tests for selected integration lane execution. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandsForCategory, runCategory } from './ci-run-lanes.mjs';

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

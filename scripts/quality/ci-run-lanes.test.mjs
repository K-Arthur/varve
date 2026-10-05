#!/usr/bin/env node

/** Regression tests for selected integration lane execution. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  demoBrowserSource,
  demoDistInputs,
  distInventory,
} from '../website/demo-dist-validation.mjs';
import { createBrowserInventory } from './browser-inventory.mjs';
import {
  commandExecutorForCategory,
  commandsForCategory,
  runCategory,
  runCategoryDetailed,
} from './ci-run-lanes.mjs';

const plan = {
  profile: 'integration',
  files: ['packages/ui/src/components/Select.tsx', 'tests/e2e/canvas/tools.spec.ts'],
  selectedLanes: ['e2e:canvas', 'js-unit:@varve/ui', 'typecheck:@varve/ui', 'pipeline-validate'],
  commitSha: 'a'.repeat(40),
  treeSha: 'b'.repeat(40),
  planHash: 'c'.repeat(64),
  policyHash: 'd'.repeat(64),
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
const [demoDistCommand] = commandsForCategory({ ...plan, selectedLanes: ['e2e:demo-dist'] }, 'e2e');
assert.deepEqual(demoDistCommand.argv.slice(0, 6), [
  'pnpm',
  'exec',
  'playwright',
  'test',
  '--config',
  'playwright.demo-dist.config.mts',
]);
for (const flag of strictFlags) assert.ok(demoDistCommand.argv.includes(flag));
const broadE2ePlan = { ...plan, selectedLanes: ['e2e:all', 'e2e:demo-dist'] };
assert.deepEqual(
  commandsForCategory(broadE2ePlan, 'e2e', { shard: '1/16' }).map(({ lane }) => lane),
  ['e2e:all', 'e2e:demo-dist'],
  'the first broad-suite shard owns the additional complete production-demo lane',
);
assert.deepEqual(
  commandsForCategory(broadE2ePlan, 'e2e', { shard: '2/16' }).map(({ lane }) => lane),
  ['e2e:all'],
  'the unsharded production-demo lane runs only once in a full browser matrix',
);
assert.throws(
  () =>
    commandsForCategory(
      { ...plan, selectedLanes: ['e2e:file:tests/e2e/browser/try-undock.spec.ts'] },
      'e2e',
    ),
  /requires the dedicated e2e:demo-dist lane/,
  'a production-demo owner cannot fall back to the root development runner',
);
for (const lane of ['e2e:all', 'e2e:canvas', 'e2e:file:tests/e2e/canvas/tools.spec.ts']) {
  const [command] = commandsForCategory({ ...plan, selectedLanes: [lane] }, 'e2e');
  for (const flag of strictFlags) assert.ok(command.argv.includes(flag), `${lane}: ${flag}`);
}
for (const lane of ['e2e:canvas', 'e2e:file:tests/e2e/canvas/tools.spec.ts']) {
  const [command] = commandsForCategory({ ...plan, selectedLanes: [lane] }, 'e2e', {
    shard: '3/16',
  });
  const shardIndex = command.argv.indexOf('--shard');
  assert.ok(shardIndex >= 0, `${lane}: a sharded cell must pass --shard`);
  assert.equal(command.argv[shardIndex + 1], '3/16', `${lane}: shard cell identity`);
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

const independentLaneRuns = [];
const independentLaneResult = runCategoryDetailed(
  { ...plan, selectedLanes: ['e2e:all', 'e2e:demo-dist'] },
  'e2e',
  {
    shard: '1/16',
    execute: (argv) => {
      const isDemo = argv.includes('playwright.demo-dist.config.mts');
      independentLaneRuns.push(isDemo ? 'e2e:demo-dist' : 'e2e:all');
      return isDemo ? 0 : 1;
    },
  },
);
assert.deepEqual(
  independentLaneRuns,
  ['e2e:all', 'e2e:demo-dist'],
  'a failing broad E2E lane must not suppress the independent production-demo lane',
);
assert.equal(independentLaneResult.status, 1, 'any selected lane failure remains blocking');
assert.deepEqual(
  independentLaneResult.outcomes.map(({ lane, status }) => [lane, status]),
  [
    ['e2e:all', 'failure'],
    ['e2e:demo-dist', 'success'],
  ],
  'the final receipt must retain both lane outcomes',
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
      discover: ({ argv, lane, source }) =>
        createBrowserInventory(browserJson, { argv, lane, source }),
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

// The production-demo lane binds its execution receipt to the staged dist's
// dedicated reporter path instead of the ordinary dev-server report folder.
const demoFixture = mkdtempSync(join(tmpdir(), 'varve-ci-demo-lane-'));
const demoDist = join(demoFixture, 'combined');
const demoSuffix = `ci-demo-lane-${process.pid}`;
const demoReportPath = join(process.cwd(), 'test-results', demoSuffix, 'playwright.json');
const demoSource = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
  encoding: 'utf8',
}).trim();
const demoTree = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{tree}'], {
  encoding: 'utf8',
}).trim();
const demoEnvNames = [
  'VARVE_DEMO_EXPECTED_SHA',
  'VARVE_DEMO_DIST_URL',
  'VARVE_DEMO_DIST_DIR',
  'VARVE_DEMO_E2E_OUTPUT_DIR',
  'VARVE_DEMO_INPUT_RECEIPT',
  'VARVE_CI_PLAYWRIGHT_REPORT',
];
const previousDemoEnv = Object.fromEntries(demoEnvNames.map((name) => [name, process.env[name]]));
for (const asset of [
  'index.html',
  'try/index.html',
  'try/varve-demo-sw.js',
  ...['varve_wasm', 'varve_wasm_simd', 'varve_colour'].flatMap((name) => [
    `try/wasm/${name}.js`,
    `try/wasm/${name}_bg.wasm`,
  ]),
]) {
  const path = join(demoDist, asset);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'fixture');
}
process.env.VARVE_DEMO_EXPECTED_SHA = demoSource;
process.env.VARVE_DEMO_DIST_URL = 'http://127.0.0.1:15645';
process.env.VARVE_DEMO_DIST_DIR = demoDist;
process.env.VARVE_DEMO_E2E_OUTPUT_DIR = demoSuffix;
process.env.VARVE_CI_PLAYWRIGHT_REPORT = demoReportPath;
const demoReceiptPath = join(demoFixture, 'artifact-input.json');
process.env.VARVE_DEMO_INPUT_RECEIPT = demoReceiptPath;
const demoInputs = demoDistInputs(process.env, process.cwd());
const demoArtifactSha = distInventory(demoDist).sha256;
const demoValidationSource = demoBrowserSource(demoInputs, demoArtifactSha, process.cwd());
writeFileSync(
  demoReceiptPath,
  JSON.stringify({
    schema: 1,
    sourceSha: demoSource,
    originalDir: demoDist,
    // demoDistInputs canonicalizes the path. This matters on macOS, where
    // tmpdir() paths commonly resolve through /var to /private/var.
    distDir: demoInputs.distDir,
    artifactSha256: demoArtifactSha,
    validationSource: demoValidationSource,
  }),
);
const demoOwners = [
  'try-demo.spec.ts',
  'try-pwa.spec.ts',
  'try-launch.spec.ts',
  'try-export.spec.ts',
  'try-undock.spec.ts',
];
const demoSpecs = demoOwners.map((owner) => ({
  file: `tests/e2e/browser/${owner}`,
  title: `certified owner ${owner}`,
  id: owner,
  line: 1,
  tests: [
    {
      projectName: 'chromium',
      expectedStatus: 'passed',
      status: 'expected',
      results: [{ retry: 0, status: 'passed', duration: 1, errors: [] }],
    },
  ],
}));
const demoBrowserJson = {
  config: {
    workers: 1,
    updateSnapshots: 'none',
    failOnFlakyTests: true,
    argv: ['--trace=retain-on-failure'],
    projects: [{ name: 'chromium', retries: 0 }],
  },
  errors: [],
  stats: { expected: demoSpecs.length, unexpected: 0, flaky: 0, skipped: 0 },
  suites: [{ title: 'production-demo fixtures', specs: demoSpecs }],
};
const demoListing = structuredClone(demoBrowserJson);
demoListing.config.argv = ['--list', '--trace=retain-on-failure'];
for (const spec of demoListing.suites[0].specs) {
  delete spec.tests[0].status;
  delete spec.tests[0].results;
}
mkdirSync(join(process.cwd(), 'test-results', demoSuffix), { recursive: true });
writeFileSync(
  join(process.cwd(), 'test-results', demoSuffix, 'expected-cases.json'),
  JSON.stringify(demoListing),
);
try {
  const demoPlan = {
    ...plan,
    commitSha: demoSource,
    treeSha: demoTree,
    selectedLanes: ['e2e:demo-dist'],
  };
  const result = runCategoryDetailed(demoPlan, 'e2e', {
    browserReportDir: join(browserLaneDirectory, 'demo-dist'),
    discover: ({ argv, lane, source }) => {
      assert.equal(lane, 'e2e:demo-dist');
      assert.ok(argv.includes('playwright.demo-dist.config.mts'));
      assert.equal(source.planHash, demoValidationSource.planHash);
      return createBrowserInventory(demoBrowserJson, { argv, lane, source });
    },
    execute: (argv, { browserReportPath }) => {
      if (argv.some((argument) => argument.endsWith('demo-dist-validation.mjs'))) {
        if (argv.at(-1) === 'verify-report') {
          execFileSync(argv[0], argv.slice(1), {
            env: { ...process.env, VARVE_CI_PLAYWRIGHT_REPORT: browserReportPath },
          });
        }
        return 0;
      }
      assert.ok(argv.includes('playwright.demo-dist.config.mts'));
      assert.equal(browserReportPath, demoReportPath);
      writeFileSync(browserReportPath, JSON.stringify(demoBrowserJson));
      return 0;
    },
  });
  assert.equal(result.status, 0);
  assert.equal(result.outcomes[0].lane, 'e2e:demo-dist');
  assert.equal(
    result.browserEvidence.reports[0].inventory.source.planHash,
    demoValidationSource.planHash,
  );
} finally {
  for (const [name, value] of Object.entries(previousDemoEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(demoFixture, { recursive: true, force: true });
  rmSync(join(process.cwd(), 'test-results', demoSuffix), { recursive: true, force: true });
}

// Rust runners execute only native Node/Cargo commands and must not load the
// pnpm-only cross-spawn adapter. Non-Rust lanes continue to use that adapter.
let secureRunnerLoads = 0;
const rustExecutor = await commandExecutorForCategory('rust', {
  loadSecureRunner: async () => {
    secureRunnerLoads += 1;
    throw new Error('Rust lanes must not load the pnpm-only command adapter');
  },
});
assert.equal(rustExecutor(['node', '-e', 'process.exit(0)'], { timeoutMs: 5000 }).status, 0);
assert.equal(secureRunnerLoads, 0);
let secureCommand;
const generalExecutor = await commandExecutorForCategory('js', {
  loadSecureRunner: async () => {
    secureRunnerLoads += 1;
    return {
      spawnValidationCommandSync: (argv, options) => {
        secureCommand = { argv, options };
        return { status: 0, signal: null, error: null };
      },
    };
  },
});
assert.equal(generalExecutor(['pnpm', 'test'], { timeoutMs: 1234 }).status, 0);
assert.deepEqual(secureCommand.argv, ['pnpm', 'test']);
assert.equal(secureCommand.options.timeout, 1234);
assert.equal(secureRunnerLoads, 1);
console.log('CI lane command runner selection passed');

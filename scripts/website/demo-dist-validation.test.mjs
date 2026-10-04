import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertDemoReport,
  assertDisposableDemoDist,
  demoBrowserSource,
  demoDistInputs,
  distInventory,
  prepareDemoDist,
  verifyUploadInventory,
} from './demo-dist-validation.mjs';

const root = process.cwd();
const directory = mkdtempSync(join(tmpdir(), 'varve-demo-dist-validation-'));
const sha = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const fixture = join(directory, 'combined');
const outputSuffix = `demo-dist-fixture-${process.pid}`;
const reportDir = join(root, 'test-results', outputSuffix);
const receiptPath = join(reportDir, 'artifact-input.json');
const environment = {
  VARVE_DEMO_EXPECTED_SHA: sha,
  VARVE_DEMO_DIST_URL: 'http://127.0.0.1:15645',
  VARVE_DEMO_DIST_DIR: fixture,
  VARVE_E2E_OUTPUT_DIR: outputSuffix,
  VARVE_DEMO_INPUT_RECEIPT: receiptPath,
};
function asset(path, bytes = 'fixture') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
for (const path of [
  'index.html',
  'try/index.html',
  'try/varve-demo-sw.js',
  ...['varve_wasm', 'varve_wasm_simd', 'varve_colour'].flatMap((name) => [
    `try/wasm/${name}.js`,
    `try/wasm/${name}_bg.wasm`,
  ]),
])
  asset(join(fixture, path));
const canonicalFixture = realpathSync(fixture);
try {
  const deploymentWorkflow = readFileSync('.github/workflows/website-deploy.yml', 'utf8');
  const sourceJob = deploymentWorkflow.split('\n  test:')[1].split('\n  release-data:')[0];
  const planStep = sourceJob.indexOf('name: Plan exact website browser source');
  const inventoryStep = sourceJob.indexOf('name: Discover complete website case inventory');
  const browserStep = sourceJob.indexOf('name: E2E in both modes');
  const receiptStep = sourceJob.indexOf('name: Verify website browser evidence');
  assert.ok(planStep >= 0 && inventoryStep > planStep && browserStep > inventoryStep);
  assert.ok(receiptStep > browserStep);
  assert.match(
    sourceJob.slice(receiptStep),
    /--plan "test-results\/\$\{VARVE_E2E_OUTPUT_DIR\}\/plan\.json"/,
  );
  assert.match(
    sourceJob.slice(receiptStep),
    /--playwright-inventory "\$\{VARVE_CI_PLAYWRIGHT_REPORT\}=test-results\/\$\{VARVE_E2E_OUTPUT_DIR\}\/browser-inventory\.json"/,
  );

  const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ciWorkflow, /demo_dist: \$\{\{ steps\.lanes\.outputs\.demo_dist \}\}/);
  const ciE2e = ciWorkflow.split('\n  e2e:\n')[1].split('\n  e2e-visual:\n')[0];
  const ciDemoSteps = [
    'name: Build website for production-demo E2E',
    'name: Build production browser demo for E2E',
    'name: Stage production demo for E2E',
    'name: Prepare disposable production-demo dist',
    'name: List complete production-demo inventory',
    'name: E2E (chromium)',
    'name: Verify complete production-demo browser evidence',
    'name: Verify production-demo source artifact unchanged',
  ];
  const ciDemoPositions = ciDemoSteps.map((step) => ciE2e.indexOf(step));
  assert.ok(ciDemoPositions.every((position) => position >= 0));
  assert.deepEqual(
    [...ciDemoPositions].sort((left, right) => left - right),
    ciDemoPositions,
    'generic CI stages the production artifact before and verifies it after its dedicated browser lane',
  );
  assert.match(ciE2e, /needs\.changes\.outputs\.demo_dist == 'true'/);
  assert.match(ciE2e, /playwright\.demo-dist\.config\.mts/);
  assert.match(ciE2e, /demo-dist-validation\.mjs prepare/);
  assert.match(ciE2e, /demo-dist-validation\.mjs verify-report/);
  assert.match(ciE2e, /demo-dist-validation\.mjs assert-unchanged/);
  assert.match(ciE2e, /VARVE_DEMO_EXPECTED_SHA: \$\{\{ needs\.changes\.outputs\.commit_sha \}\}/);
  assert.match(ciE2e, /VARVE_DEMO_DIST_URL: http:\/\/127\.0\.0\.1:15645/);
  assert.match(ciE2e, /matrix\.shard == 1/);
  assert.match(ciE2e, /playwright\.json\.inventory\.json/);

  const candidateWorkflow = readFileSync('.github/workflows/release-candidate.yml', 'utf8');
  assert.match(candidateWorkflow, /ref: \$\{\{ needs\.changes\.outputs\.commit_sha \}\}/);
  const candidateE2e = candidateWorkflow.split('\n  e2e:\n')[1].split('\n  e2e-visual:\n')[0];
  const candidateDemoSteps = [
    'name: Build website for production-demo E2E',
    'name: Build production browser demo for E2E',
    'name: Stage production demo for E2E',
    'name: Prepare disposable production-demo dist',
    'name: List complete production-demo inventory',
    'name: Production-demo E2E (candidate)',
    'name: Verify complete production-demo browser evidence',
    'name: Verify production-demo source artifact unchanged',
  ];
  const candidateDemoPositions = candidateDemoSteps.map((step) => candidateE2e.indexOf(step));
  assert.ok(candidateDemoPositions.every((position) => position >= 0));
  assert.deepEqual(
    [...candidateDemoPositions].sort((left, right) => left - right),
    candidateDemoPositions,
    'candidate triage and final both build, list, execute, and verify the exact-SHA production artifact',
  );
  const candidateReceipt = candidateE2e.split('name: Write browser execution receipt')[1];
  assert.match(candidateReceipt, /--lanes e2e:all,e2e:demo-dist/);
  assert.match(candidateReceipt, /--playwright-report e2e:demo-dist=/);
  assert.match(candidateReceipt, /--playwright-inventory .*browser-inventory\.json/);
  assert.match(candidateReceipt, /--playwright-shard e2e:demo-dist=/);
  assert.match(candidateE2e, /name: Upload immutable candidate production-demo inventory/);
  assert.match(candidateE2e, /if: matrix\.shard == 1/);
  const defaultPlaywrightConfig = readFileSync('playwright.config.ts', 'utf8');
  assert.match(defaultPlaywrightConfig, /IMPACT_CONFIG\.demoDistE2eOwners/);
  assert.match(defaultPlaywrightConfig, /testIgnore: \[\/visual/);
  const original = distInventory(fixture).sha256;
  const configPath = resolve(import.meta.dirname, '../../playwright.demo-dist.config.mts');
  const serialized = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `const {default:c}=await import(${JSON.stringify(pathToFileURL(configPath).href)});console.log(JSON.stringify(c))`,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ...environment,
        VARVE_CI_PLAYWRIGHT_REPORT: join(reportDir, 'playwright.json'),
      },
      encoding: 'utf8',
    },
  );
  const config = JSON.parse(serialized.trim());
  assert.deepEqual(config.testMatch, [
    'try-demo.spec.ts',
    'try-pwa.spec.ts',
    'try-launch.spec.ts',
    'try-export.spec.ts',
    'try-undock.spec.ts',
  ]);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.failOnFlakyTests, true);
  assert.equal(config.updateSnapshots, 'none');
  assert.equal(config.globalTimeout, 900000);
  assert.equal(config.use.trace, 'retain-on-failure');
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.ok(config.webServer.command.includes(canonicalFixture));
  assert.equal(config.globalSetup, undefined);
  assert.equal(config.projects.length, 1);
  assert.equal(config.projects[0].name, 'chromium');
  for (const name of ['VARVE_DEMO_EXPECTED_SHA', 'VARVE_DEMO_DIST_URL', 'VARVE_DEMO_DIST_DIR']) {
    const env = { ...environment };
    delete env[name];
    assert.throws(() => demoDistInputs(env, root), new RegExp(name));
  }
  assert.throws(
    () => demoDistInputs({ ...environment, VARVE_DEMO_EXPECTED_SHA: 'a'.repeat(40) }, root),
    /source SHA mismatch/,
  );
  for (const url of [
    'https://127.0.0.1:15645',
    'http://example.com:15645',
    'http://127.0.0.1:15645/try/',
    'http://127.0.0.1:15645/?try=1',
  ])
    assert.throws(
      () => demoDistInputs({ ...environment, VARVE_DEMO_DIST_URL: url }, root),
      /isolated/,
    );
  assert.throws(
    () => demoDistInputs({ ...environment, VARVE_CI_PLAYWRIGHT_REPORT: 'package.json' }, root),
    /isolated built-demo report/,
  );
  assert.throws(
    () =>
      demoDistInputs(
        { ...environment, VARVE_CI_PLAYWRIGHT_REPORT: join(reportDir, 'artifacts', 'report.json') },
        root,
      ),
    /isolated built-demo report/,
  );
  const fakeRoot = join(directory, 'synthetic-root');
  for (const path of ['apps/website/dist', 'apps/website/dist-pages', 'apps/desktop/dist-try']) {
    const canonical = join(fakeRoot, path);
    mkdirSync(canonical, { recursive: true });
    for (const candidate of [canonical, join(canonical, 'nested'), fakeRoot])
      assert.throws(() => assertDisposableDemoDist(candidate, fakeRoot), /disposable/);
  }
  const symlinkedRoot = join(directory, 'synthetic-root-link');
  try {
    symlinkSync(fakeRoot, symlinkedRoot, 'dir');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
  }
  if (symlinkedRoot !== fakeRoot && existsSync(symlinkedRoot)) {
    assert.throws(
      () => assertDisposableDemoDist(symlinkedRoot, fakeRoot),
      /disposable/,
      'a symlinked alias of the project temp root cannot hide canonical output overlap',
    );
    assert.throws(
      () => assertDisposableDemoDist(join(symlinkedRoot, 'apps/website/dist/nested'), fakeRoot),
      /disposable/,
      'nonexistent descendants are checked through their real parent path',
    );
  }
  const overlapping = join(root, 'test-results', outputSuffix, 'served');
  mkdirSync(overlapping, { recursive: true });
  for (const assetPath of distInventory(fixture).files) asset(join(overlapping, assetPath.path));
  assert.throws(
    () => demoDistInputs({ ...environment, VARVE_DEMO_DIST_DIR: overlapping }, root),
    /overlap/,
  );
  const missingAsset = join(fixture, 'try/wasm/varve_wasm_bg.wasm');
  rmSync(missingAsset);
  assert.throws(() => demoDistInputs(environment, root), /ENOENT|required asset/);
  asset(missingAsset);
  assert.equal(distInventory(fixture).sha256, original);

  // A green one-case-per-owner subset must fail against the real full listing.
  const files = config.testMatch;
  const specs = files.map((file) => ({
    file,
    title: `case ${file}`,
    id: file,
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
  function report(items, list = false) {
    return {
      config: {
        workers: 1,
        updateSnapshots: 'none',
        failOnFlakyTests: true,
        argv: list ? ['--list', '--trace=retain-on-failure'] : ['--trace=retain-on-failure'],
        projects: [{ name: 'chromium', retries: 0 }],
      },
      errors: [],
      stats: { expected: items.length, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [{ title: 'fixtures', specs: structuredClone(items) }],
    };
  }
  const all = [...specs, { ...specs[0], title: 'second required save case', id: 'extra-save' }];
  mkdirSync(reportDir, { recursive: true });
  const inputReceipt = {
    schema: 1,
    sourceSha: sha,
    originalDir: canonicalFixture,
    distDir: canonicalFixture,
    artifactSha256: original,
    validationSource: demoBrowserSource(demoDistInputs(environment, root), original, root),
  };
  asset(receiptPath, JSON.stringify(inputReceipt));
  const listing = report(all, true);
  for (const spec of listing.suites[0].specs) {
    delete spec.tests[0].status;
    delete spec.tests[0].results;
  }
  asset(join(reportDir, 'expected-cases.json'), JSON.stringify(listing));
  asset(join(reportDir, 'playwright.json'), JSON.stringify(report(specs)));
  assert.throws(() => assertDemoReport(environment, root), /complete configured case inventory/);
  asset(join(reportDir, 'playwright.json'), JSON.stringify(report(all)));
  assertDemoReport(environment, root);
  const proof = JSON.parse(readFileSync(join(reportDir, 'artifacts/execution-evidence.json')));
  assert.deepEqual(proof.errors, []);
  assert.equal(proof.artifactSha256, original);
  assert.equal(proof.evidence.reports[0].lane, 'e2e:demo-dist');
  assert.deepEqual(proof.evidence.reports[0].inventory.source, {
    commitSha: inputReceipt.validationSource.commitSha,
    treeSha: inputReceipt.validationSource.treeSha,
    planHash: inputReceipt.validationSource.planHash,
    policyHash: inputReceipt.validationSource.policyHash,
  });
  assert.equal(proof.evidence.reviewOnly, undefined);
  assert.equal(proof.evidence.reports[0].inventory.caseCount, all.length);
  assert.throws(
    () => assertDemoReport({ ...environment, VARVE_DEMO_INPUT_RECEIPT: undefined }, root),
    /VARVE_DEMO_INPUT_RECEIPT/,
  );
  assert.throws(
    () => assertDemoReport({ ...environment, VARVE_DEMO_DIST_URL: 'http://127.0.0.1:15646' }, root),
    /identity mismatch/,
  );
  for (const key of ['commitSha', 'treeSha', 'policyHash', 'planHash']) {
    const mismatched = structuredClone(inputReceipt);
    mismatched.validationSource[key] = '0'.repeat(inputReceipt.validationSource[key].length);
    asset(receiptPath, JSON.stringify(mismatched));
    assert.throws(() => assertDemoReport(environment, root), /identity mismatch/);
  }
  const changedArtifact = { ...inputReceipt, artifactSha256: '0'.repeat(64) };
  asset(receiptPath, JSON.stringify(changedArtifact));
  assert.throws(() => assertDemoReport(environment, root), /identity mismatch/);
  asset(receiptPath, JSON.stringify(inputReceipt));
  const flaky = report(all);
  flaky.stats.expected--;
  flaky.stats.flaky++;
  flaky.suites[0].specs[0].tests[0].status = 'flaky';
  asset(join(reportDir, 'playwright.json'), JSON.stringify(flaky));
  assert.throws(() => assertDemoReport(environment, root), /flaky/);
  const filtered = report(all, true);
  filtered.config.argv.push('--grep=case');
  asset(join(reportDir, 'expected-cases.json'), JSON.stringify(filtered));
  asset(join(reportDir, 'playwright.json'), JSON.stringify(report(all)));
  assert.throws(() => assertDemoReport(environment, root), /complete configured case inventory/);
  assert.equal(
    distInventory(fixture).sha256,
    original,
    'config and report checks must not modify media input',
  );
  const receipt = { schema: 1, sourceSha: sha, originalDir: fixture, artifactSha256: original };
  verifyUploadInventory(receipt, sha, fixture);
  const sw = join(fixture, 'try/varve-demo-sw.js');
  const copiedSw = join(directory, 'served-worker.js');
  copyFileSync(sw, copiedSw);
  asset(copiedSw, 'updated disposable worker');
  verifyUploadInventory(receipt, sha, fixture);
  asset(sw, 'unexpected upload mutation');
  assert.throws(() => verifyUploadInventory(receipt, sha, fixture), /upload artifact changed/);
  asset(sw);
  assert.throws(
    () => verifyUploadInventory(receipt, 'a'.repeat(40), fixture),
    /upload artifact changed/,
  );
  const before = distInventory(fixture).sha256;
  assert.throws(
    () => prepareDemoDist({ ...environment, VARVE_DEMO_EXPECTED_SHA: undefined }, root),
    /VARVE_DEMO_EXPECTED_SHA/,
  );
  assert.equal(distInventory(fixture).sha256, before);
  console.log('Built-demo config/preflight/report regression checks passed');
} finally {
  rmSync(directory, { recursive: true, force: true });
  rmSync(reportDir, { recursive: true, force: true });
}

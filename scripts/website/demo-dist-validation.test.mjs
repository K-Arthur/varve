import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertDemoReport,
  assertDisposableDemoDist,
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
const environment = {
  VARVE_DEMO_EXPECTED_SHA: sha,
  VARVE_DEMO_DIST_URL: 'http://127.0.0.1:15645',
  VARVE_DEMO_DIST_DIR: fixture,
  VARVE_E2E_OUTPUT_DIR: outputSuffix,
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
try {
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
  ]);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.failOnFlakyTests, true);
  assert.equal(config.updateSnapshots, 'none');
  assert.equal(config.globalTimeout, 900000);
  assert.equal(config.use.trace, 'retain-on-failure');
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.ok(config.webServer.command.includes(fixture));
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
  asset(join(reportDir, 'expected-cases.json'), JSON.stringify(report(all, true)));
  asset(join(reportDir, 'playwright.json'), JSON.stringify(report(specs)));
  assert.throws(() => assertDemoReport(environment, root), /complete configured case inventory/);
  asset(join(reportDir, 'playwright.json'), JSON.stringify(report(all)));
  assertDemoReport(environment, root);
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

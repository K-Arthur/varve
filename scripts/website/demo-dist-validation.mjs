import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactSensitive } from '../ci/failure-manifest.mjs';
import { createBrowserInventory, readInventorySource } from '../quality/browser-inventory.mjs';
import { browserEvidenceErrors, collectBrowserEvidence } from '../quality/ci-execution-report.mjs';
import { computePolicyHash } from '../quality/validation-policy.mjs';

export const DEMO_DIST_OWNERS = [
  'try-demo.spec.ts',
  'try-pwa.spec.ts',
  'try-launch.spec.ts',
  'try-export.spec.ts',
];
const DEMO_BROWSER_LANE = 'e2e:demo-dist';
const DEMO_BROWSER_COMMAND = [
  'pnpm',
  'exec',
  'playwright',
  'test',
  '--config',
  'playwright.demo-dist.config.mts',
];
const REQUIRED_ASSETS = [
  'index.html',
  'try/index.html',
  'try/varve-demo-sw.js',
  ...['varve_wasm', 'varve_wasm_simd', 'varve_colour'].flatMap((name) => [
    `try/wasm/${name}.js`,
    `try/wasm/${name}_bg.wasm`,
  ]),
];
function required(env, name) {
  if (!env[name]) throw new Error(`${name} is required for built-demo validation`);
  return env[name];
}
export function currentDemoSource(env = process.env, root = process.cwd()) {
  const expected = required(env, 'VARVE_DEMO_EXPECTED_SHA');
  if (!/^[a-f0-9]{40}$/.test(expected))
    throw new Error('VARVE_DEMO_EXPECTED_SHA must be an exact source SHA');
  const actual = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (actual !== expected) throw new Error('built-demo source SHA mismatch');
  return actual;
}
function contains(parent, child) {
  const value = relative(parent, child);
  return (
    value === '' ||
    (!value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      value !== '..' &&
      !isAbsolute(value))
  );
}
export function distInventory(directory) {
  const files = [];
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('built-demo artifacts must not contain symlinks');
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile())
        files.push({
          path: relative(directory, full).replaceAll('\\', '/'),
          bytes: stat.size,
          sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
        });
      else throw new Error('unsupported built-demo artifact');
    }
  }
  visit(directory);
  return { files, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}
export function assertDisposableDemoDist(distDir, root) {
  for (const canonical of [
    'apps/website/dist',
    'apps/website/dist-pages',
    'apps/desktop/dist-try',
  ]) {
    const canonicalPath = resolve(root, canonical);
    const original = existsSync(canonicalPath) ? realpathSync(canonicalPath) : canonicalPath;
    if (contains(original, distDir) || contains(distDir, original))
      throw new Error(
        'built-demo validation requires a disposable dist copy outside canonical outputs',
      );
  }
}
export function demoDistInputs(env = process.env, root = process.cwd()) {
  const sourceSha = currentDemoSource(env, root);
  const url = new URL(required(env, 'VARVE_DEMO_DIST_URL'));
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    Number(url.port) < 1024 ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('VARVE_DEMO_DIST_URL must be an isolated http://127.0.0.1:port origin');
  const distDir = realpathSync(required(env, 'VARVE_DEMO_DIST_DIR'));
  assertDisposableDemoDist(distDir, root);
  distInventory(distDir);
  for (const asset of REQUIRED_ASSETS)
    if (!lstatSync(join(distDir, asset)).isFile())
      throw new Error(`built-demo required asset missing: ${asset}`);
  const outputSuffix = env.VARVE_E2E_OUTPUT_DIR || `demo-dist-${process.pid}-${url.port}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(outputSuffix) || outputSuffix.split('/').includes('..'))
    throw new Error('invalid isolated built-demo output suffix');
  const reportDir = resolve(root, 'test-results', outputSuffix);
  const outputDir = join(reportDir, 'artifacts');
  const report = resolve(
    root,
    env.VARVE_CI_PLAYWRIGHT_REPORT || join(reportDir, 'playwright.json'),
  );
  if (
    ![join(reportDir, 'playwright.json'), join(reportDir, 'expected-cases.json')].includes(report)
  )
    throw new Error(
      'VARVE_CI_PLAYWRIGHT_REPORT must be an isolated built-demo report outside artifacts',
    );
  if (contains(distDir, reportDir) || contains(reportDir, distDir))
    throw new Error('built-demo test output must not overlap disposable dist');
  return { sourceSha, origin: url.origin, port: Number(url.port), distDir, outputDir, report };
}
export function prepareDemoDist(env = process.env, root = process.cwd()) {
  const sourceSha = currentDemoSource(env, root);
  const originalDir = realpathSync(resolve(root, 'apps/website/dist'));
  const inventory = distInventory(originalDir);
  const directory = mkdtempSync(join(tmpdir(), 'varve-built-demo-'));
  const distDir = join(directory, 'combined');
  cpSync(originalDir, distDir, { recursive: true });
  const inputs = demoDistInputs({ ...env, VARVE_DEMO_DIST_DIR: distDir }, root);
  if (distInventory(distDir).sha256 !== inventory.sha256)
    throw new Error('disposable built-demo copy differs from upload artifact');
  const receiptPath = join(dirname(inputs.outputDir), 'artifact-input.json');
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(
    receiptPath,
    `${JSON.stringify({ schema: 1, sourceSha, originalDir, distDir, artifactSha256: inventory.sha256, validationSource: demoBrowserSource(inputs, inventory.sha256, root), files: inventory.files, runId: env.GITHUB_RUN_ID ?? null, runAttempt: env.GITHUB_RUN_ATTEMPT ?? null }, null, 2)}\n`,
  );
  appendFileSync(
    required(env, 'GITHUB_ENV'),
    `VARVE_DEMO_DIST_DIR=${distDir}\nVARVE_DEMO_INPUT_RECEIPT=${receiptPath}\n`,
  );
  return receiptPath;
}

/** Bind production-demo discovery to source, policy, origin and the exact upload input. */
export function demoBrowserSource(inputs, artifactSha256, root = process.cwd()) {
  if (!/^[a-f0-9]{64}$/.test(artifactSha256 ?? ''))
    throw new Error('built-demo upload input requires a valid digest');
  const source = readInventorySource(root);
  if (source.commitSha !== inputs.sourceSha) throw new Error('built-demo source SHA mismatch');
  const policyHash = computePolicyHash({ root });
  const body = {
    schema: 1,
    lane: DEMO_BROWSER_LANE,
    commitSha: source.commitSha,
    treeSha: source.treeSha,
    policyHash,
    command: DEMO_BROWSER_COMMAND,
    owners: DEMO_DIST_OWNERS,
    origin: inputs.origin,
    artifactSha256,
  };
  return {
    commitSha: source.commitSha,
    treeSha: source.treeSha,
    policyHash,
    planHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
  };
}
export function verifyUploadInventory(receipt, sourceSha, originalDir) {
  if (
    receipt.schema !== 1 ||
    receipt.sourceSha !== sourceSha ||
    receipt.originalDir !== originalDir ||
    distInventory(originalDir).sha256 !== receipt.artifactSha256
  )
    throw new Error('original Pages upload artifact changed during built-demo validation');
}
export function assertUploadUnchanged(env = process.env, root = process.cwd()) {
  const sourceSha = currentDemoSource(env, root);
  const receipt = JSON.parse(readFileSync(required(env, 'VARVE_DEMO_INPUT_RECEIPT'), 'utf8'));
  const original = realpathSync(resolve(root, 'apps/website/dist'));
  verifyUploadInventory(receipt, sourceSha, original);
}
export function assertDemoReport(env = process.env, root = process.cwd()) {
  const inputs = demoDistInputs(env, root);
  const errors = [];
  const listingPath = join(dirname(inputs.outputDir), 'expected-cases.json');
  let inventory = null;
  let inputReceipt = null;
  try {
    inputReceipt = JSON.parse(readFileSync(required(env, 'VARVE_DEMO_INPUT_RECEIPT'), 'utf8'));
    const source = demoBrowserSource(inputs, inputReceipt.artifactSha256, root);
    if (
      inputReceipt.schema !== 1 ||
      inputReceipt.sourceSha !== inputs.sourceSha ||
      inputReceipt.distDir !== inputs.distDir ||
      JSON.stringify(inputReceipt.validationSource) !== JSON.stringify(source)
    )
      throw new Error('built-demo inventory source or upload-input identity mismatch');
    const listJson = JSON.parse(readFileSync(listingPath, 'utf8'));
    const listArgs = listJson.config?.argv ?? [];
    if (
      !listArgs.includes('--list') ||
      listArgs.some((arg) =>
        /^--(?:grep|grep-invert|shard|last-failed|test-list|only-changed|repeat-each)(?:=|$)/.test(
          arg,
        ),
      )
    )
      throw new Error('built-demo report does not cover the complete configured case inventory');
    inventory = createBrowserInventory(listJson, {
      lane: DEMO_BROWSER_LANE,
      argv: DEMO_BROWSER_COMMAND,
      source,
    });
    writeFileSync(
      join(dirname(inputs.outputDir), 'browser-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    );
  } catch (error) {
    errors.push(
      `built-demo inventory rejected: ${error instanceof SyntaxError ? 'malformed JSON' : redactSensitive(String(error.message))}`,
    );
  }
  const evidence = collectBrowserEvidence([
    { lane: DEMO_BROWSER_LANE, path: inputs.report, inventory },
  ]);
  errors.push(...browserEvidenceErrors(evidence, [DEMO_BROWSER_LANE]));
  const report = evidence.reports[0];
  const expectedIds = inventory?.cases.map((item) => item.caseId).sort() ?? [];
  const actualIds = report?.cases.map((item) => item.caseId).sort() ?? [];
  if (
    !expectedIds.length ||
    new Set(expectedIds).size !== expectedIds.length ||
    JSON.stringify(expectedIds) !== JSON.stringify(actualIds)
  )
    errors.push('built-demo report does not cover the complete configured case inventory');
  const owners = new Set(report?.cases.map((item) => item.file.split('/').at(-1)) ?? []);
  if (
    DEMO_DIST_OWNERS.some((owner) => !owners.has(owner)) ||
    owners.size !== DEMO_DIST_OWNERS.length ||
    report?.stats.skipped !== 0
  )
    errors.push('built-demo owning cases missing or skipped');
  mkdirSync(inputs.outputDir, { recursive: true });
  writeFileSync(
    join(inputs.outputDir, 'execution-evidence.json'),
    `${JSON.stringify({ sourceSha: inputs.sourceSha, artifactSha256: inputReceipt?.artifactSha256 ?? null, runId: env.GITHUB_RUN_ID ?? null, runAttempt: env.GITHUB_RUN_ATTEMPT ?? null, evidence, errors }, null, 2)}\n`,
  );
  if (errors.length) throw new Error(errors.join('; '));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (command === 'prepare') prepareDemoDist();
  else if (command === 'assert-unchanged') assertUploadUnchanged();
  else if (command === 'verify-report') assertDemoReport();
  else throw new Error('expected prepare, assert-unchanged or verify-report');
}

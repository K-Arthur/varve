const assert = require('node:assert/strict');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { dirname, join, normalize, relative, sep, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const crossSpawn = require('cross-spawn');
const { preflightWebsitePorts, websiteE2ePorts } = require('./e2e-ports.cjs');

const listen = (server, port = 0) =>
  new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen({ port, exclusive: true }, () => accept(server.address().port));
  });
const close = (server) =>
  new Promise((accept, reject) => server.close((error) => (error ? reject(error) : accept())));

/**
 * Remove a scratch tree, tolerating a transient Windows EPERM/EBUSY.
 *
 * A spawned pnpm process can still hold a handle on its working directory for a
 * moment after it exits, which makes an immediate `rmSync` throw `EPERM` on
 * windows-latest. Retry briefly within a bounded deadline; a persistent failure
 * still throws so a real leak is never hidden.
 */
function removeDirectoryWithRetry(directory, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || Date.now() >= deadline)
        throw error;
      // Busy-wait deliberately: this runs in a test teardown, and a synchronous
      // retry keeps the ordering guarantees the assertions above rely on.
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},40)']);
    }
  }
}
async function availablePair() {
  const pages = createServer();
  const root = createServer();
  const result = { pages: await listen(pages), root: await listen(root) };
  await close(pages);
  await close(root);
  return result;
}
const envFor = (ports) => ({
  VARVE_WEBSITE_E2E_PORT: String(ports.pages),
  VARVE_WEBSITE_E2E_PORT_ROOT: String(ports.root),
});

test('Playwright cleanup cannot erase website certification plans or reports', () => {
  const sourceRoot = join(__dirname, '../..');
  const suffix = 'website-output-safety-fixture';
  const configPath = join(sourceRoot, 'playwright.website.config.ts');
  const serialized = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `const {default:c}=await import(${JSON.stringify(pathToFileURL(configPath).href)});console.log(JSON.stringify({outputDir:c.outputDir,reporter:c.reporter}))`,
    ],
    {
      cwd: sourceRoot,
      env: {
        ...process.env,
        VARVE_E2E_OUTPUT_DIR: suffix,
        VARVE_CI_PLAYWRIGHT_REPORT: join('test-results', suffix, 'playwright.json'),
      },
      encoding: 'utf8',
    },
  );
  const config = JSON.parse(serialized.trim());
  const runDir = resolve(sourceRoot, 'test-results', suffix);
  const outputDir = resolve(sourceRoot, config.outputDir);
  assert.equal(relative(runDir, outputDir), join('playwright-output'));

  const workflow = readFileSync(join(sourceRoot, '.github/workflows/website-deploy.yml'), 'utf8');
  const durableEvidence = [
    'plan.json',
    'browser-inventory.json',
    'execution-evidence.json',
    'playwright.json',
    'progress.json',
  ];
  for (const filename of durableEvidence) {
    const path = join(runDir, filename);
    const fromOutput = relative(outputDir, path);
    assert.equal(fromOutput.split(sep)[0], '..', `${filename} must be outside outputDir`);
    if (filename === 'playwright.json') {
      assert.match(
        workflow,
        /VARVE_CI_PLAYWRIGHT_REPORT:\s*test-results\/website-deploy-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\/playwright\.json/,
        'the JSON case history must use the workflow run directory',
      );
    } else if (filename !== 'progress.json') {
      assert.ok(
        workflow.includes(`test-results/\${VARVE_E2E_OUTPUT_DIR}/${filename}`),
        `${filename} must use the workflow's durable run directory`,
      );
    }
  }
  const progressReporter = config.reporter.find(
    (reporter) => Array.isArray(reporter) && reporter[0].includes('browser-progress.mjs'),
  );
  assert.equal(
    normalize(progressReporter?.[1]?.outputFile ?? ''),
    join('test-results', suffix, 'progress.json'),
  );
  const jsonReporter = config.reporter.find(
    (reporter) => Array.isArray(reporter) && reporter[0] === 'json',
  );
  assert.equal(
    normalize(jsonReporter?.[1]?.outputFile ?? ''),
    join('test-results', suffix, 'playwright.json'),
  );
});

test('isolated defaults avoid Astro development ports and explicit overrides win independently', () => {
  assert.deepEqual(websiteE2ePorts({}), { pages: 15991, root: 15992 });
  assert.deepEqual(websiteE2ePorts({ VARVE_WEBSITE_E2E_PORT: '24561' }), {
    pages: 24561,
    root: 15992,
  });
  assert.deepEqual(websiteE2ePorts({ VARVE_WEBSITE_E2E_PORT_ROOT: '24562' }), {
    pages: 15991,
    root: 24562,
  });
});
test('invalid and duplicate ports fail before creating a server or building', () => {
  for (const value of ['', '0', '65536', '12.5', 'foo', '-1'])
    assert.throws(() => websiteE2ePorts({ VARVE_WEBSITE_E2E_PORT: value }));
  assert.throws(() => websiteE2ePorts({ VARVE_WEBSITE_E2E_PORT: '15992' }), /distinct/);
});
test('real free ports pass and every probe socket is released', async () => {
  const pair = await availablePair();
  assert.deepEqual(await preflightWebsitePorts(envFor(pair)), pair);
  const pages = createServer();
  const root = createServer();
  try {
    await listen(pages, pair.pages);
    await listen(root, pair.root);
  } finally {
    await close(pages);
    await close(root);
  }
});
test('a real occupied second port rejects and releases the first probe without evicting its owner', async () => {
  const pair = await availablePair();
  const occupied = createServer();
  await listen(occupied, pair.root);
  try {
    await assert.rejects(
      () => preflightWebsitePorts(envFor(pair)),
      /VARVE_WEBSITE_E2E_PORT_ROOT.*before building/,
    );
    assert.equal(occupied.listening, true);
    const released = createServer();
    await listen(released, pair.pages);
    await close(released);
  } finally {
    await close(occupied);
  }
});
test('the actual package script stops on a real collision before either build or browser command', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'varve-site-port-owner-'));
  const pair = await availablePair();
  const occupied = createServer();
  await listen(occupied, pair.pages);
  try {
    const sourceRoot = join(__dirname, '../..');
    const scripts = JSON.parse(readFileSync(join(sourceRoot, 'package.json'))).scripts;
    const script = scripts['test:website:e2e'];
    const leased = scripts['_test:website:e2e:leased'];
    assert.ok(script.startsWith('node scripts/website/e2e-ports.cjs --check && '));
    assert.ok(leased.indexOf('pnpm build:website &&') < leased.indexOf('pnpm build:website:pages'));
    assert.ok(
      leased.includes(
        'playwright test -c playwright.website.config.ts --retries=0 --update-snapshots=none --fail-on-flaky-tests --trace=retain-on-failure',
      ),
    );
    mkdirSync(join(repo, 'scripts/website'), { recursive: true });
    writeFileSync(
      join(repo, 'scripts/website/e2e-ports.cjs'),
      readFileSync(join(__dirname, 'e2e-ports.cjs')),
    );
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        private: true,
        scripts: {
          'test:website:e2e': script,
          '_test:website:e2e:leased': leased,
          'build:website': 'node forbidden.mjs',
          'build:website:pages': 'node forbidden.mjs',
        },
      }),
    );
    const forbidden = join(repo, 'unexpected-build');
    writeFileSync(
      join(repo, 'forbidden.mjs'),
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(forbidden)},'build-started');`,
    );
    const result = crossSpawn.sync(
      'pnpm',
      ['test:website:e2e', 'apps/website/tests/e2e/visual.spec.ts', '--workers=1'],
      { cwd: repo, encoding: 'utf8', env: { ...process.env, ...envFor(pair) } },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /port.*unavailable/);
    assert.equal(existsSync(forbidden), false);
    assert.equal(occupied.listening, true);
  } finally {
    // Remove the tree *before* closing the socket. On Windows the spawned pnpm
    // tree can still hold a handle on this directory, so rmSync raced the
    // process teardown and threw EPERM; that failed the whole `test:ci:tools`
    // chain on windows-latest (CI run 37200374335) even though this assertion
    // had already passed. Freeing the socket first would also let another
    // waiter in this file claim the port while this tree is still being removed.
    removeDirectoryWithRetry(repo);
    await close(occupied);
  }
});

test('the public script acquires one lease and forwards the exact website spec to its fresh-build owner', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'varve-site-one-lease-'));
  const pair = await availablePair();
  try {
    const sourceRoot = join(__dirname, '../..');
    const scripts = JSON.parse(readFileSync(join(sourceRoot, 'package.json'))).scripts;
    const helper = join(repo, 'scripts/website/e2e-ports.cjs');
    mkdirSync(dirname(helper), { recursive: true });
    writeFileSync(helper, readFileSync(join(__dirname, 'e2e-ports.cjs')));
    mkdirSync(join(repo, 'scripts/quality'), { recursive: true });
    const flow = join(repo, 'flow.jsonl');
    writeFileSync(
      join(repo, 'scripts/quality/heavy-lease.mjs'),
      `import {appendFileSync} from 'node:fs';import {createRequire} from 'node:module';const spawn=createRequire(${JSON.stringify(join(sourceRoot, 'package.json'))})('cross-spawn');appendFileSync(process.env.TEST_WEBSITE_FLOW_LOG,JSON.stringify({kind:'lease',args:process.argv.slice(2)})+'\\n');const args=process.argv.slice(process.argv.indexOf('--')+1);const result=spawn.sync(args[0],args.slice(1),{stdio:'inherit',env:process.env});process.exitCode=result.status??1;`,
    );
    writeFileSync(
      join(repo, 'build.mjs'),
      `import {appendFileSync} from 'node:fs';appendFileSync(process.env.TEST_WEBSITE_FLOW_LOG,JSON.stringify({kind:'build',args:process.argv.slice(2)})+'\\n');`,
    );
    const bin = join(repo, 'node_modules/.bin');
    mkdirSync(bin, { recursive: true });
    const browser = `import {appendFileSync} from 'node:fs';appendFileSync(process.env.TEST_WEBSITE_FLOW_LOG,JSON.stringify({kind:'browser',args:process.argv.slice(2)})+'\\n');`;
    writeFileSync(join(bin, 'playwright.mjs'), browser);
    writeFileSync(join(bin, 'playwright'), `#!${process.execPath}\n${browser}`, { mode: 0o755 });
    writeFileSync(
      join(bin, 'playwright.cmd'),
      `@echo off\r\n"${process.execPath}" "%~dp0playwright.mjs" %*\r\n`,
    );
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        private: true,
        scripts: {
          'test:website:e2e': scripts['test:website:e2e'],
          '_test:website:e2e:leased': scripts['_test:website:e2e:leased'],
          'build:website': 'node build.mjs root',
          'build:website:pages': 'node build.mjs pages',
        },
      }),
    );
    const owner = 'apps/website/tests/e2e/visual.spec.ts';
    const result = crossSpawn.sync('pnpm', ['test:website:e2e', owner, '--workers=2'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, ...envFor(pair), TEST_WEBSITE_FLOW_LOG: flow },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const history = readFileSync(flow, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      history.map((item) => item.kind),
      ['lease', 'build', 'build', 'browser'],
    );
    assert.deepEqual(
      history.filter((item) => item.kind === 'build').map((item) => item.args),
      [['root'], ['pages']],
    );
    const args = history[3].args;
    assert.ok(args.includes(owner));
    assert.ok(args.includes('--workers=2'));
    assert.equal(args[args.indexOf('-c') + 1], 'playwright.website.config.ts');
    assert.ok(args.includes('--retries=0'));
    assert.ok(args.includes('--update-snapshots=none'));
    assert.ok(args.includes('--fail-on-flaky-tests'));
    assert.ok(args.includes('--trace=retain-on-failure'));
    assert.ok(!args.includes('--project=chromium'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
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
    await close(occupied);
    rmSync(repo, { recursive: true, force: true });
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

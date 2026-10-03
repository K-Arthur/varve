import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';

// Fixture roots are only used by the independent original/patched review.
// The committed runtime owner resolves the actual installed consumer graphs.
const fixture = process.env.VARVE_BUILD_ADVISORY_FIXTURE_ROOT;
const root = process.env.VARVE_BUILD_ADVISORY_REPO_ROOT ?? resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const astroRequire = fixture
  ? null
  : createRequire(realpathSync(resolve(root, 'apps/website/node_modules/astro/package.json')));
const tailwindRequire = fixture
  ? null
  : createRequire(
      createRequire(resolve(root, 'apps/website/package.json')).resolve('@astrojs/tailwind'),
    );
const micromatchRequire = fixture
  ? null
  : createRequire(createRequire(tailwindRequire.resolve('tailwindcss')).resolve('micromatch'));
const CachePolicy = require(
  fixture
    ? resolve(fixture, 'http-cache-semantics/index.js')
    : astroRequire.resolve('http-cache-semantics'),
);
const braces = require(
  fixture ? resolve(fixture, 'braces/index.js') : micromatchRequire.resolve('braces'),
);

const request = (headers = {}) => ({
  url: 'https://cache.example.test/shared',
  method: 'GET',
  headers: { host: 'cache.example.test', ...headers },
});
const response = (headers = {}) => ({
  status: 200,
  headers: { date: new Date(2_000_000).toUTCString(), ...headers },
});
const staleRequest = () => request({ 'cache-control': 'max-stale=100000' });
function policy(headers, options = {}) {
  let now = 2_000_000;
  class DeterministicPolicy extends CachePolicy {
    now() {
      return now;
    }
  }
  const result = new DeterministicPolicy(request(), response(headers), options);
  now += 2_000;
  return result;
}

for (const [name, headers] of [
  ['shared session cookie', { 'set-cookie': 'session=other-user', 'cache-control': 'max-age=0' }],
  [
    'shared immutable session cookie',
    { 'set-cookie': 'session=other-user', 'cache-control': 'immutable, max-age=0' },
  ],
  ['proxy revalidation', { 'cache-control': 'proxy-revalidate, max-age=0' }],
  ['no-cache response', { 'cache-control': 'no-cache' }],
  ['non-storable response', { 'cache-control': 'no-store' }],
]) {
  test(`cache refuses client max-stale for ${name}`, () => {
    const p = policy(headers);
    assert.equal(p.satisfiesWithoutRevalidation(staleRequest()), false);
    const evaluated = p.evaluateRequest(staleRequest());
    assert.equal(evaluated.response, undefined);
    assert.equal(evaluated.revalidation.synchronous, true);
  });
}

test('ordinary expired public cache entries retain bounded max-stale behavior', () => {
  const p = policy({ 'cache-control': 'public, max-age=1' });
  assert.equal(p.satisfiesWithoutRevalidation(staleRequest()), true);
  assert.equal(p.satisfiesWithoutRevalidation(request({ 'cache-control': 'max-stale=0' })), false);
});
test('explicitly public cookies and private caches retain existing opt-in semantics', () => {
  const headers = { 'set-cookie': 'public=opt-in', 'cache-control': 'public, max-age=1' };
  assert.equal(policy(headers).satisfiesWithoutRevalidation(staleRequest()), true);
  assert.equal(
    policy(
      { 'set-cookie': 'private=profile', 'cache-control': 'max-age=1' },
      { shared: false },
    ).satisfiesWithoutRevalidation(staleRequest()),
    true,
  );
});
test('fresh public cache TTL remains intact for the Astro remote-image owner', () => {
  const p = policy({ 'cache-control': 'public, max-age=60' });
  assert.equal(p.storable(), true);
  assert.ok(p.timeToLive() > 0);
  assert.equal(p.satisfiesWithoutRevalidation(request()), true);
});

const nested = (open, close, depth) => open.repeat(depth) + 'a,b' + close.repeat(depth);
for (const method of ['compile', 'expand', 'stringify']) {
  test(`braces ${method} rejects 4,500 nested containers before recursive walking`, () => {
    assert.throws(() => braces[method](nested('{', '}', 4500)), {
      name: 'SyntaxError',
      message: 'AST nesting exceeds the maximum depth of 100',
    });
  });
}
test('braces also bounds nested parenthesis ASTs', () => {
  assert.throws(() => braces.compile(nested('(', ')', 4500)), {
    name: 'SyntaxError',
    message: 'AST nesting exceeds the maximum depth of 100',
  });
});
test('normal checked-in Tailwind patterns, expansion and ranges remain compatible', () => {
  assert.equal(
    braces.compile('./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'),
    './src/**/*.(astro|html|js|jsx|md|mdx|svelte|ts|tsx|vue)',
  );
  assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d']);
  assert.deepEqual(braces.expand('{1..3}'), ['1', '2', '3']);
  assert.doesNotThrow(() => braces.compile(nested('{', '}', 100)));
  assert.throws(() => braces.compile(nested('{', '}', 101)), SyntaxError);
});
test('escaped, quoted and bracketed braces remain literal without false depth rejection', () => {
  for (const input of [
    String.raw`\{`.repeat(200),
    '"' + '{'.repeat(200) + '"',
    '[' + '{'.repeat(200) + ']',
  ])
    assert.doesNotThrow(() => braces.compile(input));
});

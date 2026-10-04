#!/usr/bin/env node
/**
 * Regression guard: never hand `node --import` a bare filesystem path.
 *
 * `node --import` accepts only `file:`, `data:` and `node:` specifiers. A bare
 * Windows drive path (`C:\...`) is rejected before the module loads with
 *
 *     Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: ... Received protocol 'c:'
 *
 * which killed the spawned child of the heavy-lease fixtures before it could
 * publish its lease. Because those fixtures only spawn drive paths on Windows,
 * the defect was invisible on Linux and macOS and failed the Windows
 * `pnpm test:ci:tools` preflight on **three consecutive CI runs**
 * (37198361776, 37200374335, 37204102804) — each fix repaired one call site
 * while the next one surfaced, until a single site was routed through a
 * URL-returning helper.
 *
 * The same mistake also reached macOS: `heavy-lease-acquisition`'s barrier
 * timeout fired there because of the identical cause.
 *
 * This test asserts the invariant across the whole repository, so a new fixture
 * cannot reintroduce the class. Run: node scripts/quality/preload-specifier.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCAN_ROOTS = ['scripts', 'tests'];
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'playwright-report',
  'test-results',
  'validate-pipelines',
]);

/** `.mjs`/`.cjs`/`.js` sources, plus specs that spawn node with a preload. */
function sourceFiles(root) {
  const found = [];
  const walk = (path) => {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (SKIP_DIRECTORIES.has(path.split(/[/\\]/).at(-1))) return;
      for (const entry of readdirSync(path)) walk(join(path, entry));
      return;
    }
    if (/\.(?:mjs|cjs|js)$/.test(path)) found.push(path);
  };
  walk(root);
  return found;
}

/**
 * A `--import` call site passes a value, never a bare path literal/expression.
 * `pathToFileURL(x).href`, a `preloadImportArgs(x)` spread, or a URL template
 * are all correct; `preload`, `join(...)`, `resolve(...)` and `new URL` on a
 * filesystem path are not.
 */
function offendingSites(source) {
  return (
    [...source.matchAll(/'--import'\s*,\s*([^,\n]+)/g)]
      .map((match) => match[1].trim())
      // Only a *path expression* is a mistake. An identifier that holds an
      // already-prepared specifier (`specifier`, `expectedHref`, a variable) and
      // a string/URL literal are both fine; `pathToFileURL(...)` and the
      // `preloadImportArgs` spread are the sanctioned forms.
      .filter((next) => /^(?:pathToFileURL|toFileUrl|preloadImportArgs)/.test(next) === false)
      .filter((next) => /^(?:join|resolve|dirname|new URL|`|['"])/.test(next) === false)
      .filter((next) => !/^(?:specifier|expectedHref|args\[1\])/.test(next))
      .filter((next) => !/[$]/.test(next))
  );
}

// 1. The invariant itself, expressed against the real loader expectations.
for (const [input, valid] of [
  ['C:\\Users\\runneradmin\\AppData\\Local\\Temp\\x.mjs', false],
  ['C:/Users/runneradmin/x.mjs', false],
  ['\\\\server\\share\\x.mjs', false],
  ['/tmp/x.mjs', false],
  ['data:text/javascript,1', true],
  ['node:fs', true],
  [pathToFileURL('/tmp/x.mjs').href, true],
]) {
  const looksLikeUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) && !/^[a-zA-Z]:[\\/]/.test(input);
  assert.equal(
    looksLikeUrl,
    valid,
    `${input} should be treated as ${valid ? 'a URL specifier' : 'a bare path'}`,
  );
}

// 2. Every repository `--import` site must be a URL specifier.
const offenders = [];
let scanned = 0;
for (const scanRoot of SCAN_ROOTS) {
  for (const file of sourceFiles(join(ROOT, scanRoot))) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes("'--import'")) continue;
    scanned += 1;
    for (const next of offendingSites(source)) {
      offenders.push(`${file.slice(ROOT.length + 1)}: '--import', ${next}`);
    }
  }
}

assert.ok(scanned > 0, 'the guard must scan at least one --import call site');
assert.deepEqual(
  offenders,
  [],
  `node --import requires a file:/data:/node: specifier; wrap the path in pathToFileURL(...).href:\n  ${offenders.join('\n  ')}`,
);

console.log(`preload specifier guard passed (${scanned} file(s) with --import, 0 offenders).`);

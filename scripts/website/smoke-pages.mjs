#!/usr/bin/env node
/**
 * Post-deployment smoke check for the GitHub Pages site.
 *
 * Runs against the live deployment URL after `actions/deploy-pages`, with
 * bounded retries: Pages can take tens of seconds to propagate a new build.
 * Every route/assets check must pass before the workflow reports success —
 * a deployment that serves a 404 for the download page is not a deployment.
 *
 * Checks: homepage, download, docs, a nested docs page, releases page,
 * sitemap, robots, favicon, OG image, and 404 behaviour. Also asserts the
 * project-site canonical prefix (/varve/) so a custom-domain misconfiguration
 * is caught here rather than by users.
 *
 * Usage:
 *   node scripts/website/smoke-pages.mjs <base-url> [--expect-prefix /varve]
 */
const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!base) {
  process.stderr.write(
    'usage: node scripts/website/smoke-pages.mjs <base-url> [--expect-prefix /varve]\n',
  );
  process.exit(2);
}
const expectPrefix = process.argv.includes('--expect-prefix')
  ? process.argv[process.argv.indexOf('--expect-prefix') + 1]
  : null;

const ROUTES = [
  '/',
  '/download/',
  '/docs/',
  '/docs/tools/color/',
  '/releases/',
  '/sitemap.xml',
  '/robots.txt',
  '/favicon.svg',
  '/og-image.png',
];
const RETRIES = 12;
const RETRY_DELAY_MS = 15_000;

async function tryRoute(path) {
  const res = await fetch(`${base}${path}`, {
    redirect: 'follow',
    headers: { 'User-Agent': 'varve-smoke-check' },
  });
  return { status: res.status, url: res.url };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let failures = 0;
let ok = 0;

for (const path of ROUTES) {
  let last = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      last = await tryRoute(path);
      const expected =
        path === '/favicon.svg' || path === '/og-image.png'
          ? 200
          : path.endsWith('sitemap.xml') || path.endsWith('robots.txt')
            ? 200
            : 200;
      if (last.status === expected) break;
    } catch (err) {
      last = { status: `error: ${err.message}`, url: '' };
    }
    await sleep(RETRY_DELAY_MS);
  }
  const good = last?.status === 200;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${path.padEnd(30)} ${last?.status}`);
  good ? ok++ : failures++;
}

// 404 behaviour: an unknown route must return 404 (Pages serves 404.html).
{
  let status = 0;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      status = (await tryRoute('/definitely-not-a-route-varve/')).status;
      if (status === 404) break;
    } catch {
      /* retry */
    }
    await sleep(RETRY_DELAY_MS);
  }
  const good = status === 404;
  console.log(
    `${good ? 'PASS' : 'FAIL'}  ${'/definitely-not-a-route-varve/'.padEnd(30)} ${status}`,
  );
  good ? ok++ : failures++;
}

// Canonical prefix check: project-site mode must serve beneath /varve/.
if (expectPrefix) {
  const home = await fetch(`${base}/`, { redirect: 'follow' });
  const html = await home.text();
  const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1] ?? '';
  const good =
    canonical.startsWith(`${base}${expectPrefix}`) ||
    canonical.startsWith(`https://k-arthur.github.io${expectPrefix}`);
  console.log(
    `${good ? 'PASS' : 'FAIL'}  canonical prefix ${expectPrefix.padEnd(22)} ${canonical || '(none)'}`,
  );
  good ? ok++ : failures++;
}

console.log(`\nSmoke check: ${ok} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

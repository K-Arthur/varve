#!/usr/bin/env node
/**
 * Screenshot manifest validation.
 *
 * Checks that the screenshot manifest (apps/website/src/data/screenshot-manifest.json)
 * is internally consistent and that every captured file it references exists,
 * is a valid PNG, has sane dimensions, and is consumed only via the manifest.
 *
 * Also verifies documentation/website references: any `/screenshots/` path in
 * docs, README, or website sources must resolve to a captured manifest entry.
 *
 * Video assets (workflow.webm, workflow.mp4) are validated separately: budget
 * checks (warn 5 MB, fail 10 MB) and cross-directory consistency.
 *
 *   node scripts/screenshots/validate.mjs [--strict]
 *
 * --strict additionally fails when any scene is skipped (used by the
 * screenshots:update path after a regeneration).
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const MANIFEST_PATH = join(ROOT, 'apps', 'website', 'src', 'data', 'screenshot-manifest.json');
const PUBLIC_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots');
const strict = process.argv.includes('--strict');

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const scenes = manifest.scenes ?? {};
let failures = 0;

function fail(msg) {
  failures++;
  console.error(`FAIL ${msg}`);
}

function pngSize(buf) {
  if (buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => buf[i] !== b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

if (!manifest.schemaVersion) fail('manifest missing schemaVersion');

const ids = Object.keys(scenes);
if (ids.length === 0) fail('manifest has no scenes');

const PNG_BUDGET_WARN = 1_000_000; // 1 MB
const PNG_BUDGET_FAIL = 2_000_000; // 2 MB
const PNG_TOTAL_BUDGET_WARN = 5_000_000; // 5 MB
const PNG_TOTAL_BUDGET_FAIL = 10_000_000; // 10 MB

const capturedFiles = new Set();
let totalPngBytes = 0;
for (const [id, scene] of Object.entries(scenes)) {
  if (typeof scene.file !== 'string' || !scene.file.endsWith('.png')) {
    fail(`${id}: missing/odd file name`);
    continue;
  }
  if (scene.status === 'captured') {
    const path = join(PUBLIC_DIR, scene.file);
    let buf;
    try {
      buf = readFileSync(path);
    } catch {
      fail(`${id}: referenced file ${scene.file} does not exist in public/screenshots`);
      continue;
    }
    if (buf.length === 0) {
      fail(`${id}: ${scene.file} is 0 bytes`);
      continue;
    }
    totalPngBytes += buf.length;
    if (buf.length > PNG_BUDGET_FAIL) {
      fail(
        `${id}: ${scene.file} exceeds ${PNG_BUDGET_FAIL / 1_000_000} MB budget (${(buf.length / 1_000_000).toFixed(2)} MB)`,
      );
    } else if (buf.length > PNG_BUDGET_WARN) {
      console.warn(
        `WARN ${id}: ${scene.file} is ${(buf.length / 1_000_000).toFixed(2)} MB (warn threshold ${PNG_BUDGET_WARN / 1_000_000} MB)`,
      );
    }
    const dims = pngSize(buf);
    if (!dims) {
      fail(`${id}: ${scene.file} is not a valid PNG`);
      continue;
    }
    // Full application frames are 1440x900; cropped detail scenes are
    // deliberately smaller but still have to be large enough to read.
    if (dims.width < 280 || dims.height < 260) {
      fail(`${id}: ${scene.file} dimensions too small (${dims.width}x${dims.height})`);
    }
    if (scene.width !== dims.width || scene.height !== dims.height) {
      fail(
        `${id}: manifest dims (${scene.width}x${scene.height}) mismatch file (${dims.width}x${dims.height})`,
      );
    }
    if (!scene.alt || scene.alt.length < 10) fail(`${id}: missing meaningful alt text`);
    capturedFiles.add(scene.file);
  } else if (scene.status === 'skipped') {
    if (!scene.reason || scene.reason.length < 5) fail(`${id}: skipped without a reason`);
  } else {
    fail(`${id}: unknown status "${scene.status}"`);
  }
}

if (totalPngBytes > PNG_TOTAL_BUDGET_FAIL) {
  fail(
    `captured PNG set exceeds ${PNG_TOTAL_BUDGET_FAIL / 1_000_000} MB total budget (${(totalPngBytes / 1_000_000).toFixed(2)} MB)`,
  );
} else if (totalPngBytes > PNG_TOTAL_BUDGET_WARN) {
  console.warn(
    `WARN captured PNG set is ${(totalPngBytes / 1_000_000).toFixed(2)} MB total (warn threshold ${PNG_TOTAL_BUDGET_WARN / 1_000_000} MB)`,
  );
}

// Every reference to screenshots in docs/marketing must resolve to a captured
// manifest entry (no stale paths, no hand-copied copies). Video and poster
// references resolve against the generated workflow assets instead of the
// manifest — they are not manifest scenes.
const refRe = /(?:src|href|poster)="[^"]*\/screenshots\/([a-z0-9-]+\.(?:png|webm|mp4))"/g;
const haystack = [
  ...globSync('docs/**/*.md', { cwd: ROOT }),
  ...globSync('README.md', { cwd: ROOT }),
  ...globSync('apps/website/src/**/*.{astro,md,ts,tsx}', { cwd: ROOT }),
].map((rel) => readFileSync(join(ROOT, rel), 'utf8'));

// Generated workflow assets that are real files but deliberately have no
// manifest scene entry.
const generatedExtras = new Set(['workflow-poster.png']);

const missingRefs = new Set();
for (const src of haystack) {
  for (const m of src.matchAll(refRe)) {
    const file = m[1];
    if (capturedFiles.has(file)) continue;
    if (generatedExtras.has(file) && existsSync(join(PUBLIC_DIR, file))) continue;
    if (/\.(webm|mp4)$/.test(file)) {
      if (!existsSync(join(PUBLIC_DIR, file))) missingRefs.add(file);
      continue;
    }
    missingRefs.add(file);
  }
}
for (const ref of missingRefs) fail(`docs/website reference to missing screenshot: ${ref}`);

// No file may exist in public/screenshots without a manifest entry (avoids
// drift between generated assets and the manifest). Video files are allowed
// as they are not tracked by the PNG manifest.
// Both output directories are checked: a renamed scene leaves its old file
// behind in each, and only the manifest knows which name is current.
for (const [label, dir] of [
  ['public/screenshots', PUBLIC_DIR],
  ['docs/screenshots/product', join(ROOT, 'docs', 'screenshots', 'product')],
]) {
  for (const file of globSync('*.png', { cwd: dir })) {
    if (capturedFiles.has(file)) continue;
    if (generatedExtras.has(file)) continue;
    fail(`orphan file in ${label}: ${file}`);
  }
}

// Video asset validation: workflow.webm / workflow.mp4 are optional but if
// present must pass budget checks and exist in both output directories.
const VIDEO_BUDGET_WARN = 5_000_000; // 5 MB
const VIDEO_BUDGET_FAIL = 10_000_000; // 10 MB
const DOCS_DIR = join(ROOT, 'docs', 'screenshots', 'product');

for (const ext of ['webm', 'mp4']) {
  const fileName = `workflow.${ext}`;
  const docsPath = join(DOCS_DIR, fileName);
  const publicPath = join(PUBLIC_DIR, fileName);
  try {
    const buf = readFileSync(publicPath);
    if (buf.length === 0) {
      fail(`workflow video ${fileName} is 0 bytes`);
    } else if (buf.length > VIDEO_BUDGET_FAIL) {
      fail(
        `workflow video ${fileName} exceeds ${VIDEO_BUDGET_FAIL / 1_000_000} MB budget (${(buf.length / 1_000_000).toFixed(1)} MB)`,
      );
    } else if (buf.length > VIDEO_BUDGET_WARN) {
      console.warn(
        `WARN workflow video ${fileName} is ${(buf.length / 1_000_000).toFixed(1)} MB (warn threshold ${VIDEO_BUDGET_WARN / 1_000_000} MB)`,
      );
    }
    // Verify docs copy matches
    try {
      const docsBuf = readFileSync(docsPath);
      if (docsBuf.length !== buf.length) {
        fail(
          `workflow video ${fileName}: docs/screenshots size (${docsBuf.length}) differs from public/screenshots (${buf.length})`,
        );
      }
    } catch {
      fail(
        `workflow video ${fileName} exists in public/screenshots but missing from docs/screenshots/product/`,
      );
    }
  } catch {
    // Video is optional — not a failure if absent
  }
}

// Poster frame: optional, but when present it must be a sane PNG within the
// standard image budget and consistent across both output directories.
{
  const fileName = 'workflow-poster.png';
  const docsPath = join(DOCS_DIR, fileName);
  const publicPath = join(PUBLIC_DIR, fileName);
  let publicBuf = null;
  try {
    publicBuf = readFileSync(publicPath);
  } catch {
    // Optional — the website embed degrades to no poster / no still
  }
  if (publicBuf) {
    if (publicBuf.length === 0) {
      fail(`workflow poster ${fileName} is 0 bytes`);
    } else if (publicBuf.length > PNG_BUDGET_FAIL) {
      fail(
        `workflow poster ${fileName} exceeds ${PNG_BUDGET_FAIL / 1_000_000} MB budget (${(publicBuf.length / 1_000_000).toFixed(2)} MB)`,
      );
    } else if (!pngSize(publicBuf)) {
      fail(`workflow poster ${fileName} is not a valid PNG`);
    }
    try {
      const docsBuf = readFileSync(docsPath);
      if (docsBuf.length !== publicBuf.length) {
        fail(
          `workflow poster ${fileName}: docs/screenshots size (${docsBuf.length}) differs from public/screenshots (${publicBuf.length})`,
        );
      }
    } catch {
      fail(
        `workflow poster ${fileName} exists in public/screenshots but missing from docs/screenshots/product/`,
      );
    }
  } else if (existsSync(docsPath)) {
    fail(
      `workflow poster ${fileName} exists in docs/screenshots/product but missing from public/screenshots`,
    );
  }
}

const skipped = Object.values(scenes).filter((s) => s.status === 'skipped');
if (strict && skipped.length > 0) {
  fail(`strict mode: ${skipped.length} scene(s) skipped`);
}

const captured = Object.values(scenes).filter((s) => s.status === 'captured').length;
console.log(
  `screenshot manifest: ${captured} captured, ${skipped.length} skipped, ${failures} violation(s)`,
);
process.exit(failures > 0 ? 1 : 0);

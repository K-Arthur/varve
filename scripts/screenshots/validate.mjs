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
 *   node scripts/screenshots/validate.mjs [--strict]
 *
 * --strict additionally fails when any scene is skipped (used by the
 * screenshots:update path after a regeneration).
 */
import { globSync, readFileSync } from 'node:fs';
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

const capturedFiles = new Set();
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

// Every reference to screenshots in docs/marketing must resolve to a captured
// manifest entry (no stale paths, no hand-copied copies).
const refRe = /(?:src|href)="[^"]*\/screenshots\/([a-z0-9-]+\.png)"/g;
const haystack = [
  ...globSync('docs/**/*.md', { cwd: ROOT }),
  ...globSync('README.md', { cwd: ROOT }),
  ...globSync('apps/website/src/**/*.{astro,md,ts,tsx}', { cwd: ROOT }),
].map((rel) => readFileSync(join(ROOT, rel), 'utf8'));

const missingRefs = new Set();
for (const src of haystack) {
  for (const m of src.matchAll(refRe)) {
    if (!capturedFiles.has(m[1])) missingRefs.add(m[1]);
  }
}
for (const ref of missingRefs) fail(`docs/website reference to missing screenshot: ${ref}`);

// No file may exist in public/screenshots without a manifest entry (avoids
// drift between generated assets and the manifest).
for (const file of globSync('*.png', { cwd: PUBLIC_DIR })) {
  if (!capturedFiles.has(file)) fail(`orphan file in public/screenshots: ${file}`);
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

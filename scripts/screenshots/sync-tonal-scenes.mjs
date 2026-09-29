#!/usr/bin/env node
/** Sync the two visually reviewed captures from tonal-workflows.spec.ts. */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MANIFEST_PATH = join(ROOT, 'apps/website/src/data/screenshot-manifest.json');
const OUTPUT_DIRS = [
  join(ROOT, 'docs/screenshots/product'),
  join(ROOT, 'apps/website/public/screenshots'),
];
const scenes = [
  {
    id: 'tonal-curves',
    capture: '01-curves-light.png',
    file: 'tonal-curves-light.png',
    alt: 'An imported photographic fixture with the Curves graph, retained channel selector and precise point controls in Varve',
    caption:
      'Precise point curves on an editable adjustment layer, with an upstream histogram and source preview.',
  },
  {
    id: 'tonal-split-tone',
    capture: '04-split-tone-light.png',
    file: 'tonal-split-tone-light.png',
    alt: 'Split Toning shadow and highlight controls beside a synthetic neutral ramp and color reference in Varve',
    caption:
      'Editable shadow and highlight toning on a synthetic reference that makes color shifts easy to compare.',
  },
];

function fail(message) {
  throw new Error(`Tonal screenshot sync failed: ${message}`);
}

if (process.argv.length !== 3) {
  fail('usage: node scripts/screenshots/sync-tonal-scenes.mjs <reviewed-capture-directory>');
}
const sourceDirectory = realpathSync(resolve(ROOT, process.argv[2]));
const reviewRoots = ['test-results', 'reports', 'docs/screenshots/tonal-workflows'].map(
  (directory) => resolve(ROOT, directory),
);
if (
  !reviewRoots.some((root) => sourceDirectory === root || sourceDirectory.startsWith(root + sep))
) {
  fail('source must be beneath test-results/, reports/, or docs/screenshots/tonal-workflows/');
}

// Validate both captures before copying or changing the shared manifest.
const prepared = scenes.map((scene) => {
  const source = join(sourceDirectory, scene.capture);
  const bytes = readFileSync(source);
  if (
    bytes.length < 24 ||
    bytes.length > 2_000_000 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    fail(`${scene.capture}: expected a PNG no larger than 2 MB`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 280 || height < 260) fail(`${scene.capture}: capture is too small to read`);
  return {
    ...scene,
    source,
    width,
    height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
});

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
if (manifest.schemaVersion !== 1 || !manifest.scenes) fail('unsupported screenshot manifest');
for (const scene of prepared) {
  const existing = manifest.scenes[scene.id];
  if (existing && existing.file !== scene.file) fail(`${scene.id}: unexpected existing filename`);
}
for (const directory of OUTPUT_DIRS) mkdirSync(directory, { recursive: true });
for (const { id, capture: _capture, source, ...scene } of prepared) {
  for (const directory of OUTPUT_DIRS) copyFileSync(source, join(directory, scene.file));
  manifest.scenes[id] = {
    ...scene,
    feature: 'tonal-adjustments',
    theme: 'light',
    status: 'captured',
    source: 'tests/e2e/effects/tonal-workflows.spec.ts',
    // Captures came from a dirty master candidate, not an exact committed SHA.
    lastValidatedAgainst: null,
  };
  process.stdout.write(
    `${id}: ${scene.file} ${scene.width}x${scene.height} sha256 ${scene.sha256}\n`,
  );
}
manifest.generatedAt = new Date().toISOString();
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/** Sync only visually reviewed plugin scenes from an isolated Playwright run. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PUBLIC_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots');
const DOCS_DIR = join(ROOT, 'docs', 'screenshots', 'product');
const MANIFEST_PATH = join(ROOT, 'apps', 'website', 'src', 'data', 'screenshot-manifest.json');
const scenes = [
  { id: 'plugin-inspector-analysis', file: 'plugin-inspector.png' },
  { id: 'plugin-manager-discovery', file: 'plugin-manager-pinned.png' },
  { id: 'plugin-permission-review', file: 'plugin-review-dark-1024.png' },
  { id: 'plugin-rename-preview', file: 'plugin-rename-preview.png' },
];

function fail(message) {
  console.error(`Plugin screenshot sync failed: ${message}`);
  process.exit(1);
}

if (process.argv.length !== 3) {
  fail('usage: node scripts/screenshots/sync-plugin-scenes.mjs <test-results/run-directory>');
}

const sourceDirectory = resolve(ROOT, process.argv[2]);
const testResultsRoot = resolve(ROOT, 'test-results') + sep;
if (!sourceDirectory.startsWith(testResultsRoot) || !existsSync(sourceDirectory)) {
  fail('source must be an existing directory beneath test-results/');
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
if (revisionResult.status !== 0) fail('could not read the source revision');
const revision = revisionResult.stdout.trim();
const prepared = [];

for (const scene of scenes) {
  const matches = globSync(`**/${scene.file}`, { cwd: sourceDirectory, nodir: true });
  if (matches.length !== 1) {
    fail(`${scene.file}: expected exactly one reviewed capture, found ${matches.length}`);
  }
  const source = join(sourceDirectory, matches[0]);
  const bytes = readFileSync(source);
  const dimensions =
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      : null;
  if (!dimensions || dimensions.width < 280 || dimensions.height < 260) {
    fail(`${scene.file}: expected a readable PNG at least 280 × 260 pixels`);
  }
  if (bytes.length === 0 || bytes.length > 2_000_000) {
    fail(`${scene.file}: capture must be between 1 byte and 2 MB`);
  }
  const entry = manifest.scenes?.[scene.id];
  if (!entry) fail(`manifest has no ${scene.id} scene`);
  prepared.push({
    ...scene,
    source,
    bytes,
    width: dimensions.width,
    height: dimensions.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    entry,
  });
}

for (const scene of prepared) {
  const basename = scene.entry.file;
  copyFileSync(scene.source, join(DOCS_DIR, basename));
  copyFileSync(join(DOCS_DIR, basename), join(PUBLIC_DIR, basename));
  Object.assign(scene.entry, {
    status: 'captured',
    width: scene.width,
    height: scene.height,
    sha256: scene.sha256,
    source: 'tests/e2e/plugins/local-manager.spec.ts',
    lastValidatedAgainst: revision,
  });
  process.stdout.write(
    `${scene.id}: ${basename} ${scene.width}x${scene.height} sha256 ${scene.sha256}\n`,
  );
}

manifest.generatedAt = new Date().toISOString();
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Updated plugin screenshot scenes for ${revision}.\n`);

#!/usr/bin/env node
/**
 * Scans test-results/ after a Playwright visual-regression run and builds
 * a manifest.json the static review UI (tests/e2e/visual/review.html)
 * reads. Copies baseline/actual/diff images into one flat output directory
 * so the review UI can reference them with plain relative paths.
 *
 * Usage: node scripts/build-visual-diff-manifest.mjs [outputDir]
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TEST_RESULTS = path.join(ROOT, 'test-results');
const SNAPSHOTS_DIR = path.join(ROOT, 'tests/e2e/visual/replay.spec.ts-snapshots');
const OUT_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'visual-diff-report');

if (!existsSync(TEST_RESULTS)) {
  console.log(
    'build-visual-diff-manifest: no test-results/ directory — nothing to report (all passed, or not run yet).',
  );
  writeFileSync(
    path.join(mkdirp(OUT_DIR), 'manifest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), entries: [] }, null, 2),
  );
  process.exit(0);
}

function mkdirp(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

mkdirp(OUT_DIR);

const entries = [];

for (const testDir of readdirSync(TEST_RESULTS)) {
  const full = path.join(TEST_RESULTS, testDir);
  if (!statSync(full).isDirectory()) continue;
  const files = readdirSync(full);
  const diffFile = files.find((f) => f.endsWith('-diff.png'));
  if (!diffFile) continue; // only report actual pixel-comparison failures

  const baseName = diffFile.replace('-diff.png', '');
  const actualFile = files.find((f) => f === `${baseName}-actual.png`);
  const expectedCandidate = readdirSync(SNAPSHOTS_DIR).find((f) => f.startsWith(baseName));

  const slug = `${testDir}-${baseName}`;
  const copy = (srcDir, file, label) => {
    if (!file) return null;
    const src = path.join(srcDir, file);
    const destName = `${slug}-${label}.png`;
    copyFileSync(src, path.join(OUT_DIR, destName));
    return destName;
  };

  entries.push({
    name: baseName,
    testDir,
    baseline: expectedCandidate ? copy(SNAPSHOTS_DIR, expectedCandidate, 'baseline') : null,
    current: copy(full, actualFile, 'current'),
    diff: copy(full, diffFile, 'diff'),
  });
}

writeFileSync(
  path.join(OUT_DIR, 'manifest.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2),
);

console.log(
  `build-visual-diff-manifest: ${entries.length} failed fixture(s) written to ${OUT_DIR}`,
);
if (entries.length > 0) {
  console.log(
    `Open ${path.join('tests/e2e/visual/review.html')} and point it at ${OUT_DIR} to review.`,
  );
}

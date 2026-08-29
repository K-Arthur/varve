#!/usr/bin/env node
/**
 * Scans test-results/ after a Playwright visual-regression run and builds
 * a manifest.json the static review UI (tests/e2e/visual/review.html)
 * reads. Copies baseline/actual/diff images into one flat output directory
 * so the review UI can reference them with plain relative paths.
 *
 * Usage: node scripts/build-visual-diff-manifest.mjs [outputDir]
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// URL.pathname is POSIX-shaped even when Node is running on Windows (for
// example, `/D:/a/varve`). Convert the file URL through Node's platform-aware
// helper so the manifest builder can inspect the checkout on every runner.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

/**
 * Find every directory holding a `-diff.png`, at any depth.
 *
 * This used to read only the immediate children of test-results/. Once
 * playwright.config.ts started isolating each execution under its own
 * `outputDir` (`test-results/run-<pid>-<port>/`), the diff images moved a
 * level deeper, every child looked like a directory with no PNGs in it, and
 * the manifest came back empty on a genuinely failing run — which is exactly
 * what happened the first time the visual job actually got to execute.
 * Walking makes this independent of how the output directory is nested.
 */
function findDiffDirs(dir, depth = 0) {
  if (depth > 4) return [];
  const found = [];
  let children;
  try {
    children = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  if (children.some((c) => c.isFile() && c.name.endsWith('-diff.png'))) {
    found.push(dir);
  }
  for (const child of children) {
    if (child.isDirectory()) found.push(...findDiffDirs(path.join(dir, child.name), depth + 1));
  }
  return found;
}

/** Playwright appends `-retryN`; the highest attempt is the settled result. */
function retryOf(dirName) {
  const match = /-retry(\d+)$/.exec(dirName);
  return match ? Number(match[1]) : 0;
}

const byFixture = new Map();

for (const full of findDiffDirs(TEST_RESULTS)) {
  const files = readdirSync(full);
  const diffFile = files.find((f) => f.endsWith('-diff.png'));
  if (!diffFile) continue; // only report actual pixel-comparison failures

  const baseName = diffFile.replace('-diff.png', '');
  const attempt = retryOf(path.basename(full));
  const existing = byFixture.get(baseName);
  if (existing && existing.attempt >= attempt) continue;

  // Resolve only — nothing is copied until the winning attempt is known, so
  // a superseded retry never leaves orphan images in the report directory.
  byFixture.set(baseName, {
    attempt,
    dir: full,
    baseName,
    testDir: path.relative(TEST_RESULTS, full).replace(/[\\/]/g, '-'),
    actualFile: files.find((f) => f === `${baseName}-actual.png`),
    diffFile,
    expectedCandidate: existsSync(SNAPSHOTS_DIR)
      ? readdirSync(SNAPSHOTS_DIR).find((f) => f.startsWith(baseName))
      : undefined,
  });
}

const entries = [...byFixture.values()]
  .sort((a, b) => a.baseName.localeCompare(b.baseName))
  .map((found) => {
    const slug = `${found.testDir}-${found.baseName}`;
    const copy = (srcDir, file, label) => {
      if (!file) return null;
      const destName = `${slug}-${label}.png`;
      copyFileSync(path.join(srcDir, file), path.join(OUT_DIR, destName));
      return destName;
    };
    return {
      name: found.baseName,
      testDir: found.testDir,
      baseline: found.expectedCandidate
        ? copy(SNAPSHOTS_DIR, found.expectedCandidate, 'baseline')
        : null,
      current: copy(found.dir, found.actualFile, 'current'),
      diff: copy(found.dir, found.diffFile, 'diff'),
    };
  });

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

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseImage } from './lib/image-analysis.mjs';

/** Compatibility sync commands accept only fresh, receipt-backed E2E output. */
export function importReviewedProducerScenes(ids, directory) {
  if (!directory) throw new Error('A reviewed test-results run directory is required');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const reviewRoot = resolve(root, 'reports/screenshot-imports');
  mkdirSync(reviewRoot, { recursive: true });
  const review = mkdtempSync(join(reviewRoot, 'review-'));
  const scenes = ids.join(',');
  for (const args of [
    ['--normalize', '--review-dir', review, '--source-scenes-dir', directory, '--scenes', scenes],
    ['--review-dir', review, '--sync-reviewed', '--scenes', scenes],
  ]) {
    const result = spawnSync(
      process.execPath,
      [resolve(root, 'scripts/screenshots/product.mjs'), ...args],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Screenshot import failed with exit ${result.status}; canonical promotion stopped`,
      );
  }
}

/** Import reviewed stills from a pinned source archive into the product library. */
export function importReviewedArchiveScenes(specPath) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(spec.sourceCommit ?? '')) {
    throw new Error('The archive source commit must be a full 40-character SHA');
  }
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) {
    throw new Error('The import spec must list at least one scene');
  }
  const manifestPath = resolve(root, 'apps/website/src/data/screenshot-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const canonical = resolve(root, 'docs/screenshots/product');
  const published = resolve(root, 'apps/website/public/screenshots');
  for (const item of spec.scenes) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id ?? '') || !/^[\w-]+\.png$/.test(item.file ?? '')) {
      throw new Error(`Invalid scene id or PNG filename: ${JSON.stringify(item)}`);
    }
    if (manifest.scenes[item.id]) throw new Error(`Scene already exists: ${item.id}`);
    const input = resolve(item.sourceFile);
    if (!existsSync(input)) throw new Error(`Missing reviewed source image: ${input}`);
    const bytes = readFileSync(input);
    const analysis = analyseImage(bytes);
    if (!analysis.valid || analysis.format !== 'png') {
      throw new Error(`${item.id}: invalid PNG: ${analysis.errors.join('; ')}`);
    }
    if (analysis.width !== 1440 || analysis.height !== 900 || bytes.length >= 2_000_000) {
      throw new Error(`${item.id}: expected a PNG under 2 MB at 1440x900`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const entry = {
      file: item.file,
      alt: item.alt,
      caption: item.caption,
      feature: item.feature,
      theme: item.theme,
      status: 'captured',
      width: analysis.width,
      height: analysis.height,
      sha256,
      kind: 'full',
      scale: 1,
      provenanceUnknown: false,
      provenance: {
        sourceRevision: spec.sourceCommit,
        sourceArchive: spec.archive,
        sourceArchiveSha256: spec.archiveSha256,
        runtime:
          'reviewed archive still, resized to 1440x900, status warning count covered, optimized to a 256-color PNG palette',
      },
    };
    writeFileSync(join(canonical, item.file), bytes);
    writeFileSync(join(published, item.file), bytes);
    manifest.scenes[item.id] = entry;
  }
  manifest.generatedAt = new Date().toISOString();
  manifest.provenance = {
    ...(manifest.provenance ?? {}),
    runtime: 'reviewed external archive import',
    importedFromCommit: spec.sourceCommit,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const specFlag = process.argv.indexOf('--archive-spec');
  if (specFlag >= 0) {
    const specPath = process.argv[specFlag + 1];
    if (!specPath || specPath.startsWith('--'))
      throw new Error('--archive-spec requires a JSON file');
    importReviewedArchiveScenes(specPath);
  }
}

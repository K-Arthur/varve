import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

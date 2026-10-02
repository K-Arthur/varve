#!/usr/bin/env node
import { importReviewedProducerScenes } from './import-reviewed.mjs';

// The caller explicitly approves these captures after visual review. The
// producer receipt supplies the capture revision, never the import-time HEAD.
if (process.argv.length !== 3) {
  throw new Error(
    'usage: node scripts/screenshots/sync-plugin-scenes.mjs <reviewed-test-results-directory>',
  );
}
importReviewedProducerScenes(
  [
    'plugin-inspector-analysis',
    'plugin-manager-discovery',
    'plugin-permission-review',
    'plugin-rename-preview',
  ],
  process.argv[2],
);

/**
 * Restoration model adapters — the only place model-specific tensor
 * semantics (channel order, padding) are declared. Providers and the
 * orchestrator stay task-agnostic.
 */

import { alignTo16, extractTileNafnet, preprocessNafnet } from '../inference/models/nafnet';
import { alignTo8, extractTile, preprocessScunet } from '../inference/models/scunet';
import type { RestorationAdapter } from './tiledRestoration';

export const scunetAdapter: RestorationAdapter = {
  preprocess: preprocessScunet,
  extractTile,
  alignDimension: alignTo8,
};

export const nafnetAdapter: RestorationAdapter = {
  preprocess: preprocessNafnet,
  extractTile: extractTileNafnet,
  alignDimension: alignTo16,
};

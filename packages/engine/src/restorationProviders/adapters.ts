/**
 * Restoration model adapters — the only place model-specific tensor
 * semantics (channel order, padding) are declared. Providers and the
 * orchestrator stay task-agnostic.
 */

import { preprocessNafnet } from '../inference/models/nafnet';
import { preprocessScunet } from '../inference/models/scunet';
import type { RestorationAdapter } from './tiledRestoration';

export const scunetAdapter: RestorationAdapter = {
  preprocess: preprocessScunet,
};

export const nafnetAdapter: RestorationAdapter = {
  preprocess: preprocessNafnet,
};

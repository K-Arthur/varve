/**
 * Post-AI mask finalization: multi-subject filtering.
 *
 * Enhances raw connected components with metadata (confidence, centroid,
 * relative area), merges nearby fragments, and assigns spatially-stable IDs.
 */

import { maskToDataUrl } from './heuristic';
import { decodeMaskDataUrl } from './maskDecode';
import {
  assignStableIds,
  filterMaskByComponents,
  findConnectedComponents,
  mergeNearbyComponents,
} from './maskOps';
import type { BackgroundRemovalResult } from './types';

export interface FinalizeMaskOptions {
  /** Component ids to keep. When omitted and multiple blobs exist, keeps largest only. */
  keepComponentIds?: number[];
  /** When true and multiple blobs, returns null maskDataUrl to signal picker needed. */
  promptIfMultiple?: boolean;
  /** When false, skip fragment merging (default: true). */
  mergeFragments?: boolean;
}

export interface FinalizeMaskResult extends BackgroundRemovalResult {
  /** Non-null when promptIfMultiple and count > 1. */
  components?: ReturnType<typeof findConnectedComponents>;
  needsSubjectPicker?: boolean;
}

function computeMinArea(width: number, height: number): number {
  // Reject isolated noise: a single blob must be at least as large as the
  // image diagonal (in pixels) and never smaller than 50 px.
  return Math.max(50, Math.round(Math.sqrt(width * height)));
}

/**
 * Filter mask to selected (or largest) connected components.
 * When `promptIfMultiple` is set and multiple significant blobs remain,
 * signals picker instead of auto-filtering.
 *
 * Enhanced: merges nearby fragments, computes per-component confidence
 * and centroid, assigns spatially-stable IDs.
 */
export async function finalizeMaskResult(
  result: BackgroundRemovalResult,
  opts: FinalizeMaskOptions = {},
): Promise<FinalizeMaskResult> {
  const { mask, width, height } = await decodeMaskDataUrl(result.maskDataUrl);
  const components = findConnectedComponents(mask, width, height);
  const minArea = computeMinArea(width, height);
  const significant = components.filter((c) => c.pixelCount >= minArea);

  if (significant.length === 0) {
    // All components were noise; clear the mask so the user isn't misled.
    const emptyMask = new Uint8Array(mask.length);
    return {
      ...result,
      maskDataUrl: maskToDataUrl(emptyMask, width, height),
      components: [],
      needsSubjectPicker: false,
    };
  }

  if (significant.length === 1) {
    const keepIds = new Set([significant[0]!.id]);
    const filtered = filterMaskByComponents(mask, width, height, keepIds);
    return {
      ...result,
      maskDataUrl: maskToDataUrl(filtered, width, height),
      components: significant,
      needsSubjectPicker: false,
    };
  }

  // Merge nearby fragments before presenting to the user
  const shouldMerge = opts.mergeFragments !== false;
  const merged = shouldMerge
    ? mergeNearbyComponents(significant, mask, width, height)
    : assignStableIds(significant);

  if (opts.promptIfMultiple) {
    return {
      ...result,
      components: merged,
      needsSubjectPicker: true,
    };
  }

  const keepIds = new Set(opts.keepComponentIds ?? [merged[0]!.id]);
  const filtered = filterMaskByComponents(mask, width, height, keepIds);
  const keptComponents = merged.filter((c) => keepIds.has(c.id));
  return {
    ...result,
    maskDataUrl: maskToDataUrl(filtered, width, height),
    components: keptComponents,
    needsSubjectPicker: false,
  };
}

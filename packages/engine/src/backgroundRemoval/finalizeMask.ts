/**
 * Post-AI mask finalization: multi-subject filtering.
 */

import { maskToDataUrl } from './heuristic';
import { decodeMaskDataUrl } from './maskDecode';
import { filterMaskByComponents, findConnectedComponents } from './maskOps';
import type { BackgroundRemovalResult } from './types';

export interface FinalizeMaskOptions {
  /** Component ids to keep. When omitted and multiple blobs exist, keeps largest only. */
  keepComponentIds?: number[];
  /** When true and multiple blobs, returns null maskDataUrl to signal picker needed. */
  promptIfMultiple?: boolean;
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

  if (opts.promptIfMultiple) {
    return {
      ...result,
      components: significant,
      needsSubjectPicker: true,
    };
  }

  const keepIds = new Set(opts.keepComponentIds ?? [significant[0]!.id]);
  const filtered = filterMaskByComponents(mask, width, height, keepIds);
  const keptComponents = significant.filter((c) => keepIds.has(c.id));
  return {
    ...result,
    maskDataUrl: maskToDataUrl(filtered, width, height),
    components: keptComponents,
    needsSubjectPicker: false,
  };
}

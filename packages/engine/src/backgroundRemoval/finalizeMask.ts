/**
 * Post-AI mask finalization: multi-subject filtering.
 */

import { decodeMaskDataUrl } from './maskDecode';
import { filterMaskByComponents, findConnectedComponents } from './maskOps';
import type { BackgroundRemovalResult } from './types';

function maskToDataUrlLocal(mask: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    imageData.data[i * 4] = v;
    imageData.data[i * 4 + 1] = v;
    imageData.data[i * 4 + 2] = v;
    imageData.data[i * 4 + 3] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

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

/**
 * Filter mask to selected (or largest) connected components.
 * When `promptIfMultiple` is set, signals picker instead of auto-filtering.
 */
export async function finalizeMaskResult(
  result: BackgroundRemovalResult,
  opts: FinalizeMaskOptions = {},
): Promise<FinalizeMaskResult> {
  const { mask, width, height } = await decodeMaskDataUrl(result.maskDataUrl);
  const components = findConnectedComponents(mask, width, height);

  if (components.length <= 1) {
    return { ...result, components, needsSubjectPicker: false };
  }

  if (opts.promptIfMultiple) {
    return {
      ...result,
      components,
      needsSubjectPicker: true,
    };
  }

  const keepIds = opts.keepComponentIds ?? (components[0] ? [components[0].id] : []);
  const filtered = filterMaskByComponents(mask, width, height, new Set(keepIds));
  return {
    ...result,
    maskDataUrl: maskToDataUrlLocal(filtered, width, height),
    components,
    needsSubjectPicker: false,
  };
}

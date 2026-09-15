import type { ExpandPadding } from './expandCanvas';

export type ExpandAnchor =
  | 'center'
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export interface ExpandAspectPreset {
  id: string;
  label: string;
  ratio: number | null;
}

export const EXPAND_ASPECT_PRESETS: readonly ExpandAspectPreset[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
] as const;

const ASPECT_EPSILON = 1e-9;

function splitExtra(extra: number, anchor: ExpandAnchor, horizontal: boolean): [number, number] {
  if (extra < 0 || !Number.isSafeInteger(extra)) {
    throw new Error('Expansion output dimensions must not be smaller than the source.');
  }
  const leadingAnchored = horizontal
    ? anchor === 'top-left' || anchor === 'left' || anchor === 'bottom-left'
    : anchor === 'top-left' || anchor === 'top' || anchor === 'top-right';
  const trailingAnchored = horizontal
    ? anchor === 'top-right' || anchor === 'right' || anchor === 'bottom-right'
    : anchor === 'bottom-left' || anchor === 'bottom' || anchor === 'bottom-right';
  if (leadingAnchored) return [0, extra];
  if (trailingAnchored) return [extra, 0];
  const leading = Math.floor(extra / 2);
  return [leading, extra - leading];
}

/**
 * Convert an output frame into source-pixel margins. The anchor names the
 * retained source position inside the new frame (for example, top-left adds
 * pixels only below and to the right).
 */
export function expandPaddingForOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  anchor: ExpandAnchor = 'center',
): ExpandPadding {
  for (const value of [sourceWidth, sourceHeight, outputWidth, outputHeight]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('Expansion dimensions must be positive whole numbers.');
    }
  }
  const extraWidth = outputWidth - sourceWidth;
  const extraHeight = outputHeight - sourceHeight;
  if (extraWidth < 0 || extraHeight < 0) {
    throw new Error('Expansion output dimensions must not be smaller than the source.');
  }
  const [left, right] = splitExtra(extraWidth, anchor, true);
  const [top, bottom] = splitExtra(extraHeight, anchor, false);
  return { top, right, bottom, left };
}

/**
 * Return the smallest output frame containing the source at a requested ratio.
 * The source is never cropped or scaled; extra pixels are distributed by the
 * selected anchor and may be applied to a corner.
 */
export function expandPaddingForAspectRatio(
  sourceWidth: number,
  sourceHeight: number,
  ratio: number,
  anchor: ExpandAnchor = 'center',
): ExpandPadding {
  if (!Number.isFinite(ratio) || ratio <= ASPECT_EPSILON) {
    throw new Error('Expansion aspect ratio must be a positive number.');
  }
  for (const value of [sourceWidth, sourceHeight]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('Expansion source dimensions must be positive whole numbers.');
    }
  }
  const sourceRatio = sourceWidth / sourceHeight;
  if (Math.abs(sourceRatio - ratio) <= ASPECT_EPSILON) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (sourceRatio > ratio) {
    return expandPaddingForOutputSize(
      sourceWidth,
      sourceHeight,
      sourceWidth,
      Math.ceil(sourceWidth / ratio),
      anchor,
    );
  }
  return expandPaddingForOutputSize(
    sourceWidth,
    sourceHeight,
    Math.ceil(sourceHeight * ratio),
    sourceHeight,
    anchor,
  );
}

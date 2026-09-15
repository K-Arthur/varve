/**
 * Backend-independent expansion geometry.
 *
 * Expansion adds pixels outside a retained source rectangle. The source is
 * copied through byte-for-byte at a known offset; only the newly covered
 * border may be synthesized. This module owns the validated plan, the
 * generation mask polarity, the padded model frame, and the protected-pixel
 * restore. It never resamples the retained source and never treats "expand"
 * as "resize".
 */

export interface ExpandMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ExpandRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExpandLimits {
  maxOutputWidth?: number;
  maxOutputHeight?: number;
  maxOutputPixels?: number;
  maxMargin?: number;
}

export const DEFAULT_EXPAND_LIMITS = {
  maxOutputWidth: 8192,
  maxOutputHeight: 8192,
  maxOutputPixels: 33_554_432,
  maxMargin: 4096,
} as const;

export interface ExpandPlan {
  sourceWidth: number;
  sourceHeight: number;
  margins: ExpandMargins;
  outputWidth: number;
  outputHeight: number;
  sourceOffsetX: number;
  sourceOffsetY: number;
  /** The retained source rectangle inside the output frame. */
  protectedRegion: ExpandRegion;
  /** Bounding box of every pixel outside the retained rectangle. */
  generatedRegion: ExpandRegion;
  expandPixels: number;
  expandRatio: number;
  /** True when every margin is zero: no pixel may be generated. */
  isNoop: boolean;
}

export type ExpandPlanRejectionCode =
  | 'invalid-source'
  | 'invalid-margin'
  | 'no-expansion'
  | 'too-large';

export interface ExpandPlanRejection {
  code: ExpandPlanRejectionCode;
  message: string;
}

export type ExpandPlanResult =
  | { ok: true; plan: ExpandPlan }
  | { ok: false; error: ExpandPlanRejection };

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Validate and normalize raw margin values. Rejections carry an actionable message. */
export function normalizeExpandMargins(margins: ExpandMargins): ExpandPlanRejection | null {
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = margins[side];
    if (!isNonNegativeInteger(value)) {
      return {
        code: 'invalid-margin',
        message: `The ${side} margin must be a whole number of pixels greater than or equal to zero.`,
      };
    }
  }
  return null;
}

export function computeExpandPlan(
  sourceWidth: number,
  sourceHeight: number,
  margins: ExpandMargins,
  limits: ExpandLimits = {},
): ExpandPlanResult {
  if (!isPositiveInteger(sourceWidth) || !isPositiveInteger(sourceHeight)) {
    return {
      ok: false,
      error: { code: 'invalid-source', message: 'The source image dimensions are invalid.' },
    };
  }
  const marginError = normalizeExpandMargins(margins);
  if (marginError) return { ok: false, error: marginError };

  const maxOutputWidth = limits.maxOutputWidth ?? DEFAULT_EXPAND_LIMITS.maxOutputWidth;
  const maxOutputHeight = limits.maxOutputHeight ?? DEFAULT_EXPAND_LIMITS.maxOutputHeight;
  const maxOutputPixels = limits.maxOutputPixels ?? DEFAULT_EXPAND_LIMITS.maxOutputPixels;
  const maxMargin = limits.maxMargin ?? DEFAULT_EXPAND_LIMITS.maxMargin;

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (margins[side] > maxMargin) {
      return {
        ok: false,
        error: {
          code: 'too-large',
          message: `The ${side} margin of ${margins[side]} px exceeds the ${maxMargin} px limit for one expansion.`,
        },
      };
    }
  }

  const outputWidth = sourceWidth + margins.left + margins.right;
  const outputHeight = sourceHeight + margins.top + margins.bottom;
  if (
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    outputWidth <= 0 ||
    outputHeight <= 0
  ) {
    return {
      ok: false,
      error: { code: 'too-large', message: 'The requested expansion dimensions overflow.' },
    };
  }
  if (outputWidth > maxOutputWidth || outputHeight > maxOutputHeight) {
    return {
      ok: false,
      error: {
        code: 'too-large',
        message: `The expanded frame would be ${outputWidth} x ${outputHeight} px, beyond the ${maxOutputWidth} x ${maxOutputHeight} px limit.`,
      },
    };
  }
  if (outputWidth * outputHeight > maxOutputPixels) {
    return {
      ok: false,
      error: {
        code: 'too-large',
        message: `The expanded frame would contain ${outputWidth * outputHeight} pixels, beyond the ${maxOutputPixels} pixel budget.`,
      },
    };
  }

  const sourceOffsetX = margins.left;
  const sourceOffsetY = margins.top;
  const protectedRegion: ExpandRegion = {
    x: sourceOffsetX,
    y: sourceOffsetY,
    width: sourceWidth,
    height: sourceHeight,
  };
  const expandPixels = outputWidth * outputHeight - sourceWidth * sourceHeight;
  return {
    ok: true,
    plan: {
      sourceWidth,
      sourceHeight,
      margins: { ...margins },
      outputWidth,
      outputHeight,
      sourceOffsetX,
      sourceOffsetY,
      protectedRegion,
      generatedRegion: { x: 0, y: 0, width: outputWidth, height: outputHeight },
      expandPixels,
      expandRatio: expandPixels / (sourceWidth * sourceHeight),
      isNoop: expandPixels === 0,
    },
  };
}

function insideRegion(x: number, y: number, region: ExpandRegion): boolean {
  return (
    x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height
  );
}

/**
 * Coverage mask for the model: 255 edits (all new border including corners),
 * 0 preserves the retained source rectangle exactly.
 */
export function expandCoverageMask(plan: ExpandPlan): Uint8Array {
  const mask = new Uint8Array(plan.outputWidth * plan.outputHeight);
  for (let y = 0; y < plan.outputHeight; y += 1) {
    for (let x = 0; x < plan.outputWidth; x += 1) {
      if (!insideRegion(x, y, plan.protectedRegion)) {
        mask[y * plan.outputWidth + x] = 255;
      }
    }
  }
  return mask;
}

export interface ExpandedFrame {
  imageData: ImageData;
  mask: Uint8Array;
  width: number;
  height: number;
}

/**
 * Build the padded model frame. New pixels are edge-clamped context only: the
 * mask covers them completely, so they can never reach the accepted output as
 * source content. The retained rectangle is copied byte-for-byte.
 */
export function buildExpandedFrame(source: ImageData, plan: ExpandPlan): ExpandedFrame {
  if (
    source.width !== plan.sourceWidth ||
    source.height !== plan.sourceHeight ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new Error('Expanded frame source does not match the expansion plan');
  }
  const imageData = new ImageData(plan.outputWidth, plan.outputHeight);
  const mask = expandCoverageMask(plan);
  const { sourceOffsetX, sourceOffsetY } = plan;
  for (let y = 0; y < plan.outputHeight; y += 1) {
    const sourceLocalY = Math.max(0, Math.min(plan.sourceHeight - 1, y - sourceOffsetY));
    for (let x = 0; x < plan.outputWidth; x += 1) {
      const sourceLocalX = Math.max(0, Math.min(plan.sourceWidth - 1, x - sourceOffsetX));
      const destination = (y * plan.outputWidth + x) * 4;
      const context = (sourceLocalY * plan.sourceWidth + sourceLocalX) * 4;
      imageData.data[destination] = source.data[context] ?? 0;
      imageData.data[destination + 1] = source.data[context + 1] ?? 0;
      imageData.data[destination + 2] = source.data[context + 2] ?? 0;
      imageData.data[destination + 3] = source.data[context + 3] ?? 0;
    }
  }
  return { imageData, mask, width: plan.outputWidth, height: plan.outputHeight };
}

/**
 * Restore the authoritative retained rectangle into a composed output. The
 * provider may return changed values inside the protected rectangle; those
 * are never trusted. Returns the number of pixels repaired.
 */
export function restoreProtectedPixels(
  output: ImageData,
  source: ImageData,
  plan: ExpandPlan,
): number {
  if (
    output.width !== plan.outputWidth ||
    output.height !== plan.outputHeight ||
    source.width !== plan.sourceWidth ||
    source.height !== plan.sourceHeight
  ) {
    throw new Error('Protected-pixel restore received mismatched frames');
  }
  let repaired = 0;
  for (let y = 0; y < plan.sourceHeight; y += 1) {
    const outputRow = (y + plan.sourceOffsetY) * plan.outputWidth + plan.sourceOffsetX;
    const sourceRow = y * plan.sourceWidth;
    for (let x = 0; x < plan.sourceWidth; x += 1) {
      const destination = (outputRow + x) * 4;
      const origin = (sourceRow + x) * 4;
      if (
        output.data[destination] !== source.data[origin] ||
        output.data[destination + 1] !== source.data[origin + 1] ||
        output.data[destination + 2] !== source.data[origin + 2] ||
        output.data[destination + 3] !== source.data[origin + 3]
      ) {
        repaired += 1;
        output.data[destination] = source.data[origin] ?? 0;
        output.data[destination + 1] = source.data[origin + 1] ?? 0;
        output.data[destination + 2] = source.data[origin + 2] ?? 0;
        output.data[destination + 3] = source.data[origin + 3] ?? 0;
      }
    }
  }
  return repaired;
}

export interface ExpandGenerationEstimate {
  /** Long side of the model input frame, e.g. 512 for the pinned LaMa graph. */
  modelFrameLongSide: number;
  /** Fraction of output resolution at which new pixels are synthesized. */
  generatedScale: number;
  /** Effective long side of synthesized detail before enlargement. */
  generatedLongSide: number;
  disclosure: string;
}

/**
 * Report the effective generation resolution so the review surface can state
 * the quality boundary instead of presenting enlarged model output as native
 * detail. LaMa letterboxes the frame into its fixed graph, so the long side of
 * the frame maps to the model's long side.
 */
export function estimateExpandGenerationResolution(
  plan: ExpandPlan,
  modelFrameLongSide = 512,
): ExpandGenerationEstimate {
  const outputLongSide = Math.max(plan.outputWidth, plan.outputHeight);
  const generatedScale = Math.min(1, modelFrameLongSide / outputLongSide);
  const generatedLongSide = Math.round(outputLongSide * generatedScale);
  return {
    modelFrameLongSide,
    generatedScale,
    generatedLongSide,
    disclosure:
      generatedScale >= 1
        ? 'New pixels are synthesized at the requested output resolution.'
        : `New border pixels are synthesized at up to ${generatedLongSide} px on the long side, then enlarged to ${outputLongSide} px. Detail in the new area is approximate.`,
  };
}

/** Convert a plan to the persisted source-pixel output frame contract. */
export function expandPlanOutputFrame(plan: ExpandPlan): {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
} {
  return {
    x: -plan.sourceOffsetX,
    y: -plan.sourceOffsetY,
    width: plan.outputWidth,
    height: plan.outputHeight,
    sourceWidth: plan.sourceWidth,
    sourceHeight: plan.sourceHeight,
  };
}

export interface ExpandWorkingFrame {
  /** Working frame dimensions divided by full output dimensions (0, 1]. */
  scale: number;
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  margins: ExpandMargins;
  /** A validated plan for the proxy-sized frame. */
  plan: ExpandPlan;
}

/**
 * Choose the largest aspect-preserving working frame that fits the device's
 * raster budget, so a large photograph can be expanded without allocating a
 * full-resolution model frame. The retained source is decoded at the proxy
 * size for conditioning only; acceptance recomposes the authoritative
 * full-resolution source, so protected pixels never pass through this scale.
 */
export function planExpandWorkingFrame(plan: ExpandPlan, maxPixels: number): ExpandWorkingFrame {
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) {
    throw new Error('Expansion working-frame budget is invalid');
  }
  const outputPixels = plan.outputWidth * plan.outputHeight;
  const scale = Math.min(1, Math.sqrt(maxPixels / outputPixels));
  let outputWidth = Math.max(1, Math.round(plan.outputWidth * scale));
  let outputHeight = Math.max(1, Math.round(plan.outputHeight * scale));
  while (outputWidth * outputHeight > maxPixels && (outputWidth > 1 || outputHeight > 1)) {
    if (outputWidth >= outputHeight && outputWidth > 1) outputWidth -= 1;
    else if (outputHeight > 1) outputHeight -= 1;
    else break;
  }
  const sourceWidth = Math.min(outputWidth, Math.max(1, Math.round(plan.sourceWidth * scale)));
  const sourceHeight = Math.min(outputHeight, Math.max(1, Math.round(plan.sourceHeight * scale)));
  const left = Math.max(
    0,
    Math.min(outputWidth - sourceWidth, Math.round(plan.sourceOffsetX * scale)),
  );
  const top = Math.max(
    0,
    Math.min(outputHeight - sourceHeight, Math.round(plan.sourceOffsetY * scale)),
  );
  const right = Math.max(0, outputWidth - sourceWidth - left);
  const bottom = Math.max(0, outputHeight - sourceHeight - top);
  const working = computeExpandPlan(sourceWidth, sourceHeight, { top, right, bottom, left });
  if (!working.ok) {
    throw new Error(`Expansion working frame is invalid: ${working.error.message}`);
  }
  if (!plan.isNoop && working.plan.isNoop) {
    throw new Error(
      'Expansion working-frame budget is too small to retain a generated border; increase the memory budget or reduce the requested output size',
    );
  }
  return {
    scale,
    outputWidth,
    outputHeight,
    sourceWidth,
    sourceHeight,
    margins: { top, right, bottom, left },
    plan: working.plan,
  };
}

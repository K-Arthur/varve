/**
 * Fit math for mockup surface placement.
 *
 * Computes the destination rect of a source content rect inside a surface
 * slot for the four fit modes:
 *
 * - contain — the whole source fits inside the slot (letterboxed);
 * - cover — the slot is fully covered, source overflows (cropped);
 * - stretch — the source is forced to the slot size (aspect changes);
 * - native — the source renders at 1:1 pixels, aligned within the slot.
 *
 * Alignment places the fitted rect within the remaining space for contain
 * and native; it is a no-op for stretch and for cover (which is fully
 * determined by the cover crop).
 *
 * Returns a rect in slot coordinates [0,0,slotW,slotH] plus the source
 * sampling rect in source-pixel coordinates (what to draw from).
 */

export type MockupFitMode = 'contain' | 'cover' | 'stretch' | 'native';
export type MockupAlignX = 'min' | 'center' | 'max';
export type MockupAlignY = 'min' | 'center' | 'max';

export interface FitResult {
  /** Destination rect in slot coordinates. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /** Source sampling rect in source pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** True when the source is scaled up beyond native size. */
  upscaled: boolean;
}

export function fitRect(
  srcW: number,
  srcH: number,
  slotW: number,
  slotH: number,
  fit: MockupFitMode,
  alignX: MockupAlignX = 'center',
  alignY: MockupAlignY = 'center',
): FitResult | null {
  if (
    !Number.isFinite(srcW) ||
    !Number.isFinite(srcH) ||
    !Number.isFinite(slotW) ||
    !Number.isFinite(slotH) ||
    srcW <= 0 ||
    srcH <= 0 ||
    slotW <= 0 ||
    slotH <= 0
  ) {
    return null;
  }

  if (fit === 'stretch') {
    return {
      dx: 0,
      dy: 0,
      dw: slotW,
      dh: slotH,
      sx: 0,
      sy: 0,
      sw: srcW,
      sh: srcH,
      upscaled: slotW > srcW || slotH > srcH,
    };
  }

  if (fit === 'native') {
    const dw = Math.min(srcW, slotW);
    const dh = Math.min(srcH, slotH);
    const align = (span: number, slot: number, mode: MockupAlignX | MockupAlignY): number => {
      if (mode === 'min') return 0;
      if (mode === 'max') return slot - span;
      return (slot - span) / 2;
    };
    return {
      dx: align(dw, slotW, alignX),
      dy: align(dh, slotH, alignY),
      dw,
      dh,
      sx: 0,
      sy: 0,
      sw: srcW,
      sh: srcH,
      upscaled: false,
    };
  }

  const srcAspect = srcW / srcH;
  const slotAspect = slotW / slotH;
  if (fit === 'contain') {
    if (srcAspect >= slotAspect) {
      const dw = slotW;
      const dh = slotW / srcAspect;
      return {
        dx: 0,
        dy: alignSpan(dh, slotH, alignY),
        dw,
        dh,
        sx: 0,
        sy: 0,
        sw: srcW,
        sh: srcH,
        upscaled: slotW > srcW,
      };
    }
    const dh = slotH;
    const dw = slotH * srcAspect;
    return {
      dx: alignSpan(dw, slotW, alignX),
      dy: 0,
      dw,
      dh,
      sx: 0,
      sy: 0,
      sw: srcW,
      sh: srcH,
      upscaled: slotH > srcH,
    };
  }

  // cover: the slot is fully covered; the source is cropped in the
  // dimension where it is relatively wide.
  if (srcAspect >= slotAspect) {
    const sh = srcH;
    const sw = sh * slotAspect;
    return {
      dx: 0,
      dy: 0,
      dw: slotW,
      dh: slotH,
      sx: alignSpan(sw, srcW, alignX),
      sy: 0,
      sw,
      sh,
      upscaled: slotW > srcW,
    };
  }
  const sw = srcW;
  const sh = sw / slotAspect;
  return {
    dx: 0,
    dy: 0,
    dw: slotW,
    dh: slotH,
    sx: 0,
    sy: alignSpan(sh, srcH, alignY),
    sw,
    sh,
    upscaled: slotH > srcH,
  };
}

function alignSpan(span: number, container: number, mode: MockupAlignX | MockupAlignY): number {
  if (mode === 'min') return 0;
  if (mode === 'max') return container - span;
  return (container - span) / 2;
}

/** True when a fit result is visually empty (degenerate inputs). */
export function isFitEmpty(result: FitResult | null): boolean {
  return !result || result.dw <= 0 || result.dh <= 0;
}

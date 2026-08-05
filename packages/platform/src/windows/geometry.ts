/**
 * Pure window-geometry math (ADR-0033).
 *
 * Everything here is a pure function of its inputs so placement
 * restoration, clamping, cascading, and fingerprinting are unit-testable
 * without any window or monitor API.
 */

import type { DisplayFingerprint, DisplayInfo, WindowPlacement, WindowState } from './types';

/** Margin reserved above a window so the title bar stays reachable. */
export const TITLE_BAR_MARGIN = 32;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp a logical placement into a display work area (logical px),
 * enforcing minimum size and keeping the top edge (title bar / drag
 * region) reachable. Returns a new placement — never mutates.
 */
export function clampPlacementToWorkArea(
  placement: WindowPlacement,
  workArea: { x: number; y: number; width: number; height: number },
  minSize: { width: number; height: number },
  state: WindowState = placement.state,
): WindowPlacement {
  if (state === 'maximized' || state === 'fullscreen') {
    return { ...placement, state };
  }
  const width = clampNumber(placement.logicalSize.width, minSize.width, workArea.width);
  const height = clampNumber(placement.logicalSize.height, minSize.height, workArea.height);
  const x = clampNumber(
    placement.logicalPosition.x,
    workArea.x,
    workArea.x + workArea.width - width,
  );
  const y = clampNumber(
    placement.logicalPosition.y,
    workArea.y,
    workArea.y + workArea.height - height,
  );
  // Title bar reachability: never allow the top edge above the work area.
  const clampedY = Math.max(y, workArea.y + TITLE_BAR_MARGIN - Math.min(height, workArea.height));
  return {
    ...placement,
    state,
    logicalPosition: { x, y: clampedY },
    logicalSize: { width, height },
  };
}

/**
 * Convert a physical position/size to logical units using a display's
 * scale factor (mixed-DPI safe, ADR-0033). Accepts x/y, width/height, or
 * all four.
 */
export function physicalToLogical(
  physical: { x?: number; y?: number; width?: number; height?: number },
  scaleFactor: number,
): { x?: number; y?: number; width?: number; height?: number } {
  const result: { x?: number; y?: number; width?: number; height?: number } = {};
  if (physical.x !== undefined) result.x = physical.x / scaleFactor;
  if (physical.y !== undefined) result.y = physical.y / scaleFactor;
  if (physical.width !== undefined) result.width = physical.width / scaleFactor;
  if (physical.height !== undefined) result.height = physical.height / scaleFactor;
  return result;
}

export function logicalToPhysical(
  logical: { x?: number; y?: number; width?: number; height?: number },
  scaleFactor: number,
): { x?: number; y?: number; width?: number; height?: number } {
  const result: { x?: number; y?: number; width?: number; height?: number } = {};
  if (logical.x !== undefined) result.x = logical.x * scaleFactor;
  if (logical.y !== undefined) result.y = logical.y * scaleFactor;
  if (logical.width !== undefined) result.width = logical.width * scaleFactor;
  if (logical.height !== undefined) result.height = logical.height * scaleFactor;
  return result;
}

/**
 * Build a conservative display fingerprint for matching saved placement to
 * current displays (ADR-0033). `relativeRole` is computed against the
 * primary display's position.
 */
export function fingerprintFromDisplay(
  display: DisplayInfo,
  primary: DisplayInfo | undefined,
): DisplayFingerprint {
  const relativeRole = computeRelativeRole(display, primary);
  return {
    name: display.name,
    physicalSizeHint: {
      width: Math.round(display.size.width / display.scaleFactor),
      height: Math.round(display.size.height / display.scaleFactor),
    },
    resolution: display.size,
    scaleFactor: display.scaleFactor,
    relativeRole,
  };
}

/** Best-effort relative position of a display against the primary. */
export function computeRelativeRole(
  display: DisplayInfo,
  primary: DisplayInfo | undefined,
): 'primary' | 'left' | 'right' | 'above' | 'below' | undefined {
  if (display.isPrimary) return 'primary';
  if (!primary) return undefined;
  const dx = display.position.x - primary.position.x;
  const dy = display.position.y - primary.position.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0 ? 'left' : 'right';
  }
  return dy < 0 ? 'above' : 'below';
}

/**
 * Conservative fuzzy matching of a saved fingerprint to a current display
 * (ADR-0033). Returns a match score in [0, 1] — 0 is no match, 1 is
 * identical. Role mismatch alone disqualifies a candidate (returns 0).
 */
export function matchDisplayFingerprint(
  saved: DisplayFingerprint,
  candidate: DisplayInfo,
  primary: DisplayInfo | undefined,
): number {
  const candidateRole = computeRelativeRole(candidate, primary);
  if (saved.relativeRole && candidateRole && saved.relativeRole !== candidateRole) {
    return 0;
  }
  if (saved.relativeRole === 'primary' && !candidate.isPrimary) return 0;
  if (candidate.isPrimary && saved.relativeRole !== 'primary') return 0;

  let score = 0.5;
  const resolutionDelta =
    Math.abs(saved.resolution.width - candidate.size.width) +
    Math.abs(saved.resolution.height - candidate.size.height);
  if (resolutionDelta === 0) {
    score += 0.3;
  } else if (resolutionDelta <= 64) {
    score += 0.15;
  }
  const scaleDelta = Math.abs(saved.scaleFactor - candidate.scaleFactor);
  if (scaleDelta === 0) score += 0.1;
  else if (scaleDelta <= 0.25) score += 0.05;

  if (saved.name && candidate.name && saved.name === candidate.name) {
    score += 0.1;
  } else if (saved.name && !candidate.name) {
    score -= 0.05;
  }
  return clampNumber(score, 0, 1);
}

/** Minimum score for a candidate to be considered a match (ADR-0033). */
export const MIN_DISPLAY_MATCH_SCORE = 0.55;

/**
 * Choose the best current display for a saved fingerprint. Returns the
 * primary display when no candidate clears the threshold — restored
 * windows are always reachable.
 */
export function pickDisplayForFingerprint(
  saved: DisplayFingerprint,
  displays: DisplayInfo[],
): DisplayInfo {
  let best: DisplayInfo | undefined;
  let bestScore = 0;
  const primary = displays.find((d) => d.isPrimary);
  for (const candidate of displays) {
    const score = matchDisplayFingerprint(saved, candidate, primary);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best && bestScore >= MIN_DISPLAY_MATCH_SCORE) return best;
  return (
    primary ??
    displays[0] ?? {
      runtimeId: 'fallback',
      isPrimary: true,
      position: { x: 0, y: 0 },
      size: { width: 1280, height: 800 },
      workArea: { x: 0, y: 0, width: 1280, height: 800 },
      scaleFactor: 1,
    }
  );
}

/**
 * Cascade placement for recovered windows on a display (ADR-0033):
 * successive windows offset diagonally, wrapped within the work area.
 */
export function cascadePlacement(
  display: DisplayInfo,
  index: number,
  size: { width: number; height: number },
  minSize: { width: number; height: number },
  state: WindowState = 'normal',
): WindowPlacement {
  const workArea = display.workArea;
  const step = 32;
  const offset = index * step;
  const width = clampNumber(size.width, minSize.width, workArea.width);
  const height = clampNumber(size.height, minSize.height, workArea.height);
  const maxOffsetX = Math.max(0, workArea.width - width - 32);
  const maxOffsetY = Math.max(0, workArea.height - height - 32);
  return {
    displayId: display.runtimeId,
    displayFingerprint: fingerprintFromDisplay(display, undefined),
    state,
    logicalPosition: {
      x: workArea.x + (offset % Math.max(1, maxOffsetX + step)),
      y: workArea.y + (offset % Math.max(1, maxOffsetY + step)),
    },
    logicalSize: { width, height },
  };
}

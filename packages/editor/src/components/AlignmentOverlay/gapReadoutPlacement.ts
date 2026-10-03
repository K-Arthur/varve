/** Canvas-local placement for numeric spacing readouts; handles never move. */
export interface GapReadoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EDGE = 8;
const GAP = 4;
const HEIGHT = 18;
const ASCENT = 14;
/** Bounds collision work for mass selection; every handle/value still renders. */
export const MAX_GAP_READOUT_PLACEMENTS = 160;

function freeHorizontalPosition(
  box: GapReadoutBox,
  occupied: readonly GapReadoutBox[],
  width: number,
): number | null {
  const intervals = occupied
    .filter((other) => box.y < other.y + other.h + GAP && other.y < box.y + box.h + GAP)
    .map((other) => ({ low: other.x - box.w - GAP, high: other.x + other.w + GAP }));
  let x = box.x;
  intervals.sort((a, b) => a.low - b.low);
  for (const interval of intervals) {
    if (x > interval.low && x < interval.high) x = interval.high;
  }
  if (x + box.w <= width - EDGE) return x;
  x = box.x;
  intervals.sort((a, b) => b.high - a.high);
  for (const interval of intervals) {
    if (x > interval.low && x < interval.high) x = interval.low;
  }
  return x >= EDGE ? x : null;
}

export function placeGapReadout(
  preferred: { x: number; y: number; text: string },
  occupied: readonly GapReadoutBox[],
  viewport: { width: number; height: number },
): { x: number; y: number; box: GapReadoutBox; shifted: boolean; reserve: boolean } {
  // Conservative monospace glyph width plus stroke padding. The readouts are
  // ASCII numbers/units; the 12px estimate covers both passive and active text.
  const w = Math.min(
    Math.max(24, preferred.text.length * 12 * 0.66 + GAP * 2),
    Math.max(24, viewport.width - EDGE * 2),
  );
  const original = { x: preferred.x - w / 2, y: preferred.y - ASCENT, w, h: HEIGHT };
  // Off-screen selections must not pull invisible values into the viewport.
  // Above the placement budget retain the existing positions and accessible
  // slider values, rather than sorting an unbounded mass-selection history.
  if (
    occupied.length >= MAX_GAP_READOUT_PLACEMENTS ||
    original.x + w < 0 ||
    original.x > viewport.width ||
    original.y + HEIGHT < 0 ||
    original.y > viewport.height
  ) {
    return { x: preferred.x, y: preferred.y, box: original, shifted: false, reserve: false };
  }
  const initial: GapReadoutBox = {
    x: Math.max(EDGE, Math.min(preferred.x - w / 2, viewport.width - w - EDGE)),
    y: Math.max(EDGE, Math.min(preferred.y - ASCENT, viewport.height - HEIGHT - EDGE)),
    w,
    h: HEIGHT,
  };
  let box = initial;
  // Keep the usual baseline when space is available. Dense readouts spread
  // horizontally first, then wrap to another row within the visible canvas.
  for (let row = 0; row <= occupied.length; row++) {
    const candidate = { ...initial, y: initial.y + row * (HEIGHT + GAP) };
    if (candidate.y + HEIGHT > viewport.height - EDGE) break;
    const x = freeHorizontalPosition(candidate, occupied, viewport.width);
    if (x !== null) {
      box = { ...candidate, x };
      break;
    }
  }
  const x = box.x + box.w / 2;
  const y = box.y + ASCENT;
  return { x, y, box, shifted: x !== preferred.x || y !== preferred.y, reserve: true };
}

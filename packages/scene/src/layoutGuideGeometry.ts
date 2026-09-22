/**
 * Canonical geometry for frame-owned layout guides.
 *
 * This module deliberately has no editor or camera dependency. Consumers
 * transform the returned local-space segments through the owning frame/page
 * transform and decide how to draw them. Snapping and rendering therefore
 * cannot disagree about margins, fixed tracks, or offsets.
 */
import {
  type LayoutGrid,
  type LayoutGuideMargins,
  MAX_LAYOUT_GUIDE_SEGMENTS,
  MAX_LAYOUT_GUIDE_TRACKS,
  MAX_LAYOUT_GUIDE_VALUE,
} from './gridTypes';

export { MAX_LAYOUT_GUIDES_PER_OWNER } from './gridTypes';

export interface LayoutGuidePoint {
  x: number;
  y: number;
}

export interface LayoutGuideSegment {
  id: string;
  start: LayoutGuidePoint;
  end: LayoutGuidePoint;
  axis: 'horizontal' | 'vertical';
  role: 'boundary' | 'track-edge' | 'lattice';
}

export interface LayoutGuideRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutGuideGeometryIssue {
  code:
    | 'invalid-frame'
    | 'invalid-margins'
    | 'invalid-count'
    | 'invalid-size'
    | 'invalid-gutter'
    | 'overflow'
    | 'too-dense';
  message: string;
}

export interface ResolvedLayoutGuideGeometry {
  valid: boolean;
  segments: LayoutGuideSegment[];
  regions: LayoutGuideRegion[];
  issues: LayoutGuideGeometryIssue[];
  /** The usable frame-local rectangle used by track layouts. */
  usable: { x: number; y: number; width: number; height: number } | null;
}

const EPSILON = 1e-7;

function issue(
  code: LayoutGuideGeometryIssue['code'],
  message: string,
): ResolvedLayoutGuideGeometry {
  return { valid: false, segments: [], regions: [], issues: [{ code, message }], usable: null };
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_LAYOUT_GUIDE_VALUE;
}

function finiteBounded(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_LAYOUT_GUIDE_VALUE;
}

function marginsFor(grid: LayoutGrid): LayoutGuideMargins | null {
  if (grid.margins) {
    const { top, right, bottom, left } = grid.margins;
    return [top, right, bottom, left].every(finiteNonNegative)
      ? { top, right, bottom, left }
      : null;
  }
  if (
    !Array.isArray(grid.margin) ||
    grid.margin.length !== 4 ||
    !grid.margin.every(finiteNonNegative)
  ) {
    return null;
  }
  const [top, right, bottom, left] = grid.margin;
  return { top, right, bottom, left };
}

function countFor(grid: LayoutGrid): number {
  const candidate =
    grid.count ?? (grid.layoutMode === 'rows' ? grid.rowCount : grid.columnCount) ?? 1;
  return candidate;
}

function fixedSizeFor(grid: LayoutGrid): number | undefined {
  return grid.trackSize ?? (grid.layoutMode === 'rows' ? grid.rowHeight : grid.columnWidth);
}

function alignmentFor(grid: LayoutGrid): 'stretch' | 'start' | 'center' | 'end' {
  if (grid.alignment === 'left') return 'start';
  if (grid.alignment === 'right') return 'end';
  return grid.alignment;
}

function pushSegment(
  segments: LayoutGuideSegment[],
  id: string,
  axis: LayoutGuideSegment['axis'],
  start: LayoutGuidePoint,
  end: LayoutGuidePoint,
  role: LayoutGuideSegment['role'],
): boolean {
  if (segments.length >= MAX_LAYOUT_GUIDE_SEGMENTS) return false;
  segments.push({ id, axis, start, end, role });
  return true;
}

function resolveTrackLayout(
  grid: LayoutGrid,
  width: number,
  height: number,
  margins: LayoutGuideMargins,
): ResolvedLayoutGuideGeometry {
  const count = countFor(grid);
  if (!Number.isInteger(count) || count < 1 || count > MAX_LAYOUT_GUIDE_TRACKS) {
    return issue(
      'invalid-count',
      `Track count must be an integer from 1 to ${MAX_LAYOUT_GUIDE_TRACKS}.`,
    );
  }
  if (!finiteNonNegative(grid.gutter))
    return issue('invalid-gutter', 'Gutter must be finite and non-negative.');

  const usable = {
    x: margins.left,
    y: margins.top,
    width: width - margins.left - margins.right,
    height: height - margins.top - margins.bottom,
  };
  if (usable.width <= 0 || usable.height <= 0) {
    return issue('invalid-margins', 'Margins leave no usable frame area.');
  }

  const horizontal = grid.layoutMode === 'rows';
  const available = horizontal ? usable.height : usable.width;
  const fixedSize = fixedSizeFor(grid);
  const sizing = grid.sizing ?? (fixedSize === undefined ? 'stretch' : 'fixed');
  if (sizing === 'fixed' && (!fixedSize || !finiteNonNegative(fixedSize))) {
    return issue('invalid-size', 'Fixed track size must be finite and greater than zero.');
  }
  const trackSize =
    sizing === 'stretch' ? (available - Math.max(0, count - 1) * grid.gutter) / count : fixedSize!;
  if (!Number.isFinite(trackSize) || trackSize <= EPSILON) {
    return issue('invalid-size', 'Track size is too small for the available frame area.');
  }

  const total = count * trackSize + Math.max(0, count - 1) * grid.gutter;
  if (total > available + EPSILON) {
    return issue('overflow', 'Tracks and gutters do not fit inside the frame margins.');
  }
  const free = Math.max(0, available - total);
  const alignment = alignmentFor(grid);
  const base = alignment === 'end' ? free : alignment === 'center' ? free / 2 : 0;
  const offset = grid.offset ?? 0;
  if (!finiteBounded(offset)) return issue('invalid-size', 'Offset must be finite and bounded.');
  const start = (horizontal ? usable.y : usable.x) + base + offset;
  const segments: LayoutGuideSegment[] = [];
  const regions: LayoutGuideRegion[] = [];

  for (let index = 0; index < count; index += 1) {
    const trackStart = start + index * (trackSize + grid.gutter);
    const trackEnd = trackStart + trackSize;
    const region = horizontal
      ? {
          id: `${grid.id}:row:${index}`,
          x: usable.x,
          y: trackStart,
          width: usable.width,
          height: trackSize,
        }
      : {
          id: `${grid.id}:column:${index}`,
          x: trackStart,
          y: usable.y,
          width: trackSize,
          height: usable.height,
        };
    regions.push(region);
    const edgeId = `${grid.id}:${horizontal ? 'row' : 'column'}:${index}`;
    const first = horizontal ? { x: usable.x, y: trackStart } : { x: trackStart, y: usable.y };
    const second = horizontal
      ? { x: usable.x + usable.width, y: trackStart }
      : { x: trackStart, y: usable.y + usable.height };
    const endFirst = horizontal ? { x: usable.x, y: trackEnd } : { x: trackEnd, y: usable.y };
    const endSecond = horizontal
      ? { x: usable.x + usable.width, y: trackEnd }
      : { x: trackEnd, y: usable.y + usable.height };
    if (
      !pushSegment(
        segments,
        `${edgeId}:start`,
        horizontal ? 'horizontal' : 'vertical',
        first,
        second,
        index === 0 ? 'boundary' : 'track-edge',
      )
    ) {
      return issue('too-dense', 'The resolved layout contains too many guide segments.');
    }
    if (
      !pushSegment(
        segments,
        `${edgeId}:end`,
        horizontal ? 'horizontal' : 'vertical',
        endFirst,
        endSecond,
        index === count - 1 ? 'boundary' : 'track-edge',
      )
    ) {
      return issue('too-dense', 'The resolved layout contains too many guide segments.');
    }
  }

  return { valid: true, segments, regions, issues: [], usable };
}

function resolveUniformLayout(
  grid: LayoutGrid,
  width: number,
  height: number,
  margins: LayoutGuideMargins,
): ResolvedLayoutGuideGeometry {
  const cellSize = grid.cellSize ?? grid.columnWidth ?? grid.rowHeight;
  if (!cellSize || !finiteNonNegative(cellSize)) {
    return issue('invalid-size', 'Uniform cell size must be finite and greater than zero.');
  }
  if (!finiteBounded(grid.offsetX ?? 0) || !finiteBounded(grid.offsetY ?? 0)) {
    return issue('invalid-size', 'Uniform grid offsets must be finite and bounded.');
  }
  const usable = {
    x: margins.left,
    y: margins.top,
    width: width - margins.left - margins.right,
    height: height - margins.top - margins.bottom,
  };
  if (usable.width <= 0 || usable.height <= 0)
    return issue('invalid-margins', 'Margins leave no usable frame area.');
  const segments: LayoutGuideSegment[] = [];
  const regions: LayoutGuideRegion[] = [];
  const originX = usable.x + (grid.offsetX ?? 0);
  const originY = usable.y + (grid.offsetY ?? 0);
  const firstX = originX + Math.ceil((usable.x - originX) / cellSize) * cellSize;
  const firstY = originY + Math.ceil((usable.y - originY) / cellSize) * cellSize;
  let index = 0;
  for (let x = firstX; x <= usable.x + usable.width + EPSILON; x += cellSize) {
    if (
      !pushSegment(
        segments,
        `${grid.id}:x:${index}`,
        'vertical',
        { x, y: usable.y },
        { x, y: usable.y + usable.height },
        'lattice',
      )
    ) {
      return issue('too-dense', 'The uniform grid contains too many guide segments.');
    }
    index += 1;
  }
  index = 0;
  for (let y = firstY; y <= usable.y + usable.height + EPSILON; y += cellSize) {
    if (
      !pushSegment(
        segments,
        `${grid.id}:y:${index}`,
        'horizontal',
        { x: usable.x, y },
        { x: usable.x + usable.width, y },
        'lattice',
      )
    ) {
      return issue('too-dense', 'The uniform grid contains too many guide segments.');
    }
    index += 1;
  }
  return { valid: true, segments, regions, issues: [], usable };
}

function resolveLegacyUniformLayout(
  grid: LayoutGrid,
  width: number,
  height: number,
  margins: LayoutGuideMargins,
): ResolvedLayoutGuideGeometry {
  const columns = resolveTrackLayout(
    { ...grid, layoutMode: 'columns', count: grid.columnCount ?? 1, trackSize: grid.columnWidth },
    width,
    height,
    margins,
  );
  const rows = resolveTrackLayout(
    { ...grid, layoutMode: 'rows', count: grid.rowCount ?? 1, trackSize: grid.rowHeight },
    width,
    height,
    margins,
  );
  if (!columns.valid) return columns;
  if (!rows.valid) return rows;
  return {
    valid: true,
    segments: [...columns.segments, ...rows.segments],
    regions: [...columns.regions, ...rows.regions],
    issues: [],
    usable: columns.usable,
  };
}

/** Resolve one frame-local layout guide without consulting editor state. */
export function resolveLayoutGuideGeometry(
  grid: LayoutGrid,
  frameWidth: number,
  frameHeight: number,
): ResolvedLayoutGuideGeometry {
  if (
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return issue('invalid-frame', 'Frame dimensions must be positive finite values.');
  }
  const margins = marginsFor(grid);
  if (!margins)
    return issue('invalid-margins', 'Margins must contain four finite non-negative values.');
  if (grid.layoutMode === 'uniform') {
    // Documents before v2.30 used Uniform for coupled row/column tracks.
    // Keep that wire shape render-compatible until the migration has supplied
    // the explicit square-cell field.
    if (
      grid.cellSize === undefined &&
      (grid.columnCount !== undefined || grid.rowCount !== undefined)
    ) {
      return resolveLegacyUniformLayout(grid, frameWidth, frameHeight, margins);
    }
    return resolveUniformLayout(grid, frameWidth, frameHeight, margins);
  }
  return resolveTrackLayout(grid, frameWidth, frameHeight, margins);
}

/** Normalize legacy tuple margins for new writers without mutating the input. */
export function canonicalLayoutGuideMargins(grid: LayoutGrid): LayoutGuideMargins {
  return marginsFor(grid) ?? { top: 0, right: 0, bottom: 0, left: 0 };
}

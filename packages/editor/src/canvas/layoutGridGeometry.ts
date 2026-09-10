import type { LayoutGrid } from '@varve/scene';

export interface LayoutGuideGeometry {
  vertical: number[];
  horizontal: number[];
  valid: boolean;
  reason?: string;
}

const MAX_TRACKS = 100;

function invalid(reason: string): LayoutGuideGeometry {
  return { vertical: [], horizontal: [], valid: false, reason };
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function addUnique(lines: number[], value: number): void {
  if (!lines.some((entry) => Math.abs(entry - value) < 1e-6)) lines.push(value);
}

function resolveTrackLines(
  start: number,
  size: number,
  count: number,
  gutter: number,
  fixedSize: number | undefined,
  alignment: LayoutGrid['alignment'],
): number[] | null {
  if (!Number.isInteger(count) || count < 1 || count > MAX_TRACKS) return null;
  if (!finiteNonNegative(gutter)) return null;

  const available = size;
  const stretchSize = (available - Math.max(0, count - 1) * gutter) / count;
  const trackSize = fixedSize ?? stretchSize;
  if (!Number.isFinite(trackSize) || trackSize <= 0) return null;

  const total = count * trackSize + Math.max(0, count - 1) * gutter;
  if (total > available + 1e-6) return null;
  const free = Math.max(0, available - total);
  const alignedStart =
    alignment === 'right' ? start + free : alignment === 'center' ? start + free / 2 : start;

  const lines: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const trackStart = alignedStart + index * (trackSize + gutter);
    addUnique(lines, trackStart);
    addUnique(lines, trackStart + trackSize);
  }
  return lines;
}

/** Resolve authored frame-local guide lines without consulting auto-layout. */
export function resolveLayoutGuideGeometry(
  grid: LayoutGrid,
  frameWidth: number,
  frameHeight: number,
): LayoutGuideGeometry {
  if (
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return invalid('Frame dimensions must be positive finite values.');
  }
  if (
    !Array.isArray(grid.margin) ||
    grid.margin.length !== 4 ||
    !grid.margin.every(finiteNonNegative)
  ) {
    return invalid('Margins must contain four non-negative values.');
  }

  const [marginTop, marginRight, marginBottom, marginLeft] = grid.margin;
  const contentWidth = frameWidth - marginLeft - marginRight;
  const contentHeight = frameHeight - marginTop - marginBottom;
  if (contentWidth <= 0 || contentHeight <= 0)
    return invalid('Margins leave no usable content area.');

  const vertical: number[] = [];
  const horizontal: number[] = [];
  if (grid.layoutMode === 'columns' || grid.layoutMode === 'uniform') {
    const columnLines = resolveTrackLines(
      marginLeft,
      contentWidth,
      grid.columnCount ?? 1,
      grid.gutter,
      grid.columnWidth,
      grid.alignment,
    );
    if (!columnLines) return invalid('Column count, width, or gutter does not fit the frame.');
    vertical.push(...columnLines);
  }
  if (grid.layoutMode === 'rows' || grid.layoutMode === 'uniform') {
    const rowLines = resolveTrackLines(
      marginTop,
      contentHeight,
      grid.rowCount ?? 1,
      grid.gutter,
      grid.rowHeight,
      grid.alignment,
    );
    if (!rowLines) return invalid('Row count, height, or gutter does not fit the frame.');
    horizontal.push(...rowLines);
  }
  return { vertical, horizontal, valid: true };
}

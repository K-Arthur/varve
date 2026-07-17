import type { FlexDirection, FrameNode, LayoutStyle, NodeId, SceneNode } from '@strata/scene';
import { nodeWorldBounds } from '../scene/world';

export interface LayoutSuggestion {
  frameId: NodeId;
  confidence: number;
  direction: FlexDirection;
  gap: number;
  alignItems: 'start' | 'center' | 'end' | 'stretch';
  suggestedStyle: LayoutStyle;
  reason: string;
}

function worldBoundsOf(
  doc: import('@strata/scene').Document,
  nodeId: NodeId,
): { x: number; y: number; w: number; h: number } | null {
  try {
    return nodeWorldBounds(doc, nodeId);
  } catch {
    return null;
  }
}

export function suggestAutoLayout(
  frame: FrameNode,
  children: SceneNode[],
  doc: import('@strata/scene').Document,
): LayoutSuggestion | null {
  if (children.length < 2) return null;
  const visible = children.filter((c) => c.visible !== false);
  if (visible.length < 2) return null;

  const bounds = visible
    .map((c) => worldBoundsOf(doc, c.id))
    .filter((b): b is NonNullable<typeof b> => b !== null);
  if (bounds.length < 2) return null;

  const rowScore = detectRowAlignment(bounds);
  const colScore = detectColumnAlignment(bounds);

  if (rowScore < 0.6 && colScore < 0.6) return null;

  const direction: FlexDirection = rowScore >= colScore ? 'row' : 'column';
  const confidence = Math.max(rowScore, colScore);

  const gaps = computeGaps(bounds, direction);
  const suggestedGap = gaps.length > 0 ? Math.round(median(gaps) / 4) * 4 : 8;

  const align = detectAlignment(bounds, direction);

  const suggestedStyle: LayoutStyle = {
    mode: 'flex',
    direction,
    gap: suggestedGap,
    wrap: false,
    padding: [0, 0, 0, 0],
    grow: 0,
    shrink: 1,
    alignItems: align,
  };

  const reason =
    direction === 'row'
      ? `Children appear to be laid out horizontally (${Math.round(confidence * 100)}% confidence)`
      : `Children appear to be laid out vertically (${Math.round(confidence * 100)}% confidence)`;

  return {
    frameId: frame.id,
    confidence,
    direction,
    gap: suggestedGap,
    alignItems: align,
    suggestedStyle,
    reason,
  };
}

function detectRowAlignment(bounds: { x: number; y: number; w: number; h: number }[]): number {
  const yRanges = bounds.map((b) => ({ min: b.y, max: b.y + b.h }));
  const xRanges = bounds.map((b) => ({ min: b.x, max: b.x + b.w }));

  const yOverlaps = countOverlaps(yRanges);
  const xOverlaps = countOverlaps(xRanges);

  const yOverlapRatio = yOverlaps / Math.max(1, bounds.length);
  const xNonOverlapRatio = 1 - xOverlaps / Math.max(1, bounds.length);

  return yOverlapRatio * 0.6 + xNonOverlapRatio * 0.4;
}

function detectColumnAlignment(bounds: { x: number; y: number; w: number; h: number }[]): number {
  const yRanges = bounds.map((b) => ({ min: b.y, max: b.y + b.h }));
  const xRanges = bounds.map((b) => ({ min: b.x, max: b.x + b.w }));

  const yOverlaps = countOverlaps(yRanges);
  const xOverlaps = countOverlaps(xRanges);

  const xOverlapRatio = xOverlaps / Math.max(1, bounds.length);
  const yNonOverlapRatio = 1 - yOverlaps / Math.max(1, bounds.length);

  return xOverlapRatio * 0.6 + yNonOverlapRatio * 0.4;
}

function countOverlaps(ranges: { min: number; max: number }[]): number {
  let count = 0;
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]!;
      const b = ranges[j]!;
      if (rangesOverlap(a, b)) count++;
    }
  }
  return count;
}

function rangesOverlap(a: { min: number; max: number }, b: { min: number; max: number }): boolean {
  return a.min < b.max && b.min < a.max;
}

function computeGaps(
  bounds: { x: number; y: number; w: number; h: number }[],
  direction: FlexDirection,
): number[] {
  const gaps: number[] = [];
  const sorted = [...bounds].sort((a, b) => {
    const aPos = direction === 'row' ? a.x : a.y;
    const bPos = direction === 'row' ? b.x : b.y;
    return aPos - bPos;
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (direction === 'row') {
      const prevEnd = prev.x + prev.w;
      gaps.push(Math.abs(curr.x - prevEnd));
    } else {
      const prevEnd = prev.y + prev.h;
      gaps.push(Math.abs(curr.y - prevEnd));
    }
  }
  return gaps;
}

function detectAlignment(
  bounds: { x: number; y: number; w: number; h: number }[],
  direction: FlexDirection,
): 'start' | 'center' | 'end' | 'stretch' {
  if (bounds.length === 0) return 'start';
  const axis = direction === 'row' ? 'y' : 'x';
  const sizeAxis = direction === 'row' ? 'h' : 'w';

  const starts = bounds.map((b) => b[axis]);
  const ends = bounds.map((b) => b[axis] + b[sizeAxis]);
  const sizes = bounds.map((b) => b[sizeAxis]);

  const startRange = Math.max(...starts) - Math.min(...starts);
  const endRange = Math.max(...ends) - Math.min(...ends);
  const sizeRange = Math.max(...sizes) - Math.min(...sizes);

  if (startRange < 4) return 'start';
  if (endRange < 4) return 'end';
  if (sizeRange > 4) return 'stretch';

  const centers = bounds.map((b) => b[axis] + b[sizeAxis] / 2);
  const centerRange = Math.max(...centers) - Math.min(...centers);
  if (centerRange < 4) return 'center';

  return 'start';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

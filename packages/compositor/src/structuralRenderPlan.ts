import type { RenderItem } from '@varve/engine';
import type { RenderStructureNode } from './types';

export type FallbackReason =
  | 'text'
  | 'path'
  | 'unsupported-primitive'
  | 'unsupported-paint'
  | 'stroke'
  | 'effect'
  | 'filter'
  | 'blend'
  | 'structural-group';

export interface RenderPlanSegment {
  kind: 'webgpu-run' | 'canvas2d-island';
  start: number;
  end: number;
  items: readonly RenderItem[];
  reasons: readonly FallbackReason[];
}

export interface StructuralRenderPlan {
  segments: readonly RenderPlanSegment[];
  nativeWebGpuItems: number;
  fallbackNodeCount: number;
  fallbackIslandCount: number;
  fallbackReasons: Readonly<Record<FallbackReason, number>>;
}

const EMPTY_REASONS: readonly FallbackReason[] = [];

function reasonForItem(item: RenderItem): FallbackReason | null {
  const primitive = item.primitive as { kind?: string };
  if (primitive.kind === 'text') return 'text';
  if (primitive.kind === 'path') return 'path';
  if (primitive.kind !== 'rect' && primitive.kind !== 'circle') return 'unsupported-primitive';
  if ((item.fills?.length ?? 0) > 0) return 'unsupported-paint';
  if ((item.strokes?.length ?? 0) > 0) return 'stroke';
  if ((item.effects?.length ?? 0) > 0) return 'effect';
  if ((item.filters?.length ?? 0) > 0) return 'filter';
  if (item.blendMode !== undefined && item.blendMode !== 'normal') return 'blend';
  return null;
}

function collectUnsupportedRanges(
  items: readonly RenderItem[],
  structure: RenderStructureNode | undefined,
): Array<{ start: number; end: number; reason: FallbackReason }> {
  const ranges: Array<{ start: number; end: number; reason: FallbackReason }> = [];

  const visit = (node: RenderStructureNode): void => {
    const start = Math.max(0, Math.min(items.length, Math.floor(node.itemStart)));
    const end = Math.max(start, Math.min(items.length, Math.floor(node.itemEnd)));
    const childRangesBefore = ranges.length;
    for (const child of node.children ?? []) visit(child);
    const ownReasons = items
      .slice(start, end)
      .map(reasonForItem)
      .filter((reason): reason is FallbackReason => reason !== null);
    if (node.fallbackBoundary && (ownReasons.length > 0 || ranges.length > childRangesBefore)) {
      ranges.splice(childRangesBefore);
      ranges.push({
        start,
        end,
        reason: (node.fallbackReason as FallbackReason | undefined) ?? 'structural-group',
      });
    }
  };

  if (structure) visit(structure);
  if (!structure || ranges.length === 0) {
    for (let index = 0; index < items.length; index++) {
      const reason = reasonForItem(items[index]!);
      if (reason) ranges.push({ start: index, end: index + 1, reason });
    }
  }
  return ranges;
}

function mergeRanges(
  ranges: Array<{ start: number; end: number; reason: FallbackReason }>,
): Array<{ start: number; end: number; reasons: FallbackReason[] }> {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number; reasons: FallbackReason[] }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      if (!last.reasons.includes(range.reason)) last.reasons.push(range.reason);
    } else {
      merged.push({ start: range.start, end: range.end, reasons: [range.reason] });
    }
  }
  return merged;
}

/** Build an ordered, fail-closed plan over the compositor's paint order. */
export function buildStructuralRenderPlan(
  items: readonly RenderItem[],
  structure?: RenderStructureNode,
): StructuralRenderPlan {
  const fallback = mergeRanges(collectUnsupportedRanges(items, structure));
  const segments: RenderPlanSegment[] = [];
  let cursor = 0;
  const fallbackReasons: Record<FallbackReason, number> = {
    text: 0,
    path: 0,
    'unsupported-primitive': 0,
    'unsupported-paint': 0,
    stroke: 0,
    effect: 0,
    filter: 0,
    blend: 0,
    'structural-group': 0,
  };

  for (const island of fallback) {
    if (cursor < island.start) {
      segments.push({
        kind: 'webgpu-run',
        start: cursor,
        end: island.start,
        items: items.slice(cursor, island.start),
        reasons: EMPTY_REASONS,
      });
    }
    segments.push({
      kind: 'canvas2d-island',
      start: island.start,
      end: island.end,
      items: items.slice(island.start, island.end),
      reasons: island.reasons,
    });
    for (const reason of island.reasons) fallbackReasons[reason]++;
    cursor = Math.max(cursor, island.end);
  }
  if (cursor < items.length) {
    segments.push({
      kind: 'webgpu-run',
      start: cursor,
      end: items.length,
      items: items.slice(cursor),
      reasons: EMPTY_REASONS,
    });
  }

  return {
    segments,
    nativeWebGpuItems: segments
      .filter((segment) => segment.kind === 'webgpu-run')
      .reduce((count, segment) => count + segment.items.length, 0),
    fallbackNodeCount: fallback.reduce((count, island) => count + (island.end - island.start), 0),
    fallbackIslandCount: fallback.length,
    fallbackReasons,
  };
}

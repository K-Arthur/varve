import type { Document, NodeId, PatternFillData } from '@varve/scene';
import { resolveNodePaints } from '@varve/scene';

export const PATTERN_NUMERIC_FIELDS = [
  'gapX',
  'gapY',
  'rowShift',
  'columnShift',
  'offsetX',
  'offsetY',
  'imageWidth',
  'imageHeight',
  'rotation',
] as const satisfies readonly (keyof PatternFillData)[];

export type PatternNumericField = (typeof PATTERN_NUMERIC_FIELDS)[number];

export type PatternFillFieldChange =
  | { type: 'set'; value: number | undefined }
  | { type: 'delta'; delta: number };

/** Merge an intentional set of pattern fields without copying the first fill's other values. */
export function applyPatternFillPatchToSelection(
  document: Document,
  nodeIds: readonly NodeId[],
  fillIndex: number,
  patch: Partial<PatternFillData>,
): Document {
  let nextNodes = document.nodes;
  let changed = false;
  for (const nodeId of nodeIds) {
    const node = nextNodes[nodeId];
    if (!node || node.paintRefs?.length) continue;
    const fills = resolveNodePaints(
      node as unknown as Parameters<typeof resolveNodePaints>[0],
      document,
    );
    const fill = fills[fillIndex];
    if (fill?.type !== 'pattern' || !fill.pattern) continue;
    const nextPattern = { ...fill.pattern, ...patch };
    if (
      Object.keys(patch).every((key) =>
        Object.is(
          fill.pattern?.[key as keyof PatternFillData],
          nextPattern[key as keyof PatternFillData],
        ),
      )
    )
      continue;
    const nextFills = [...fills];
    nextFills[fillIndex] = { ...fill, pattern: nextPattern };
    if (!changed) nextNodes = { ...document.nodes };
    nextNodes[nodeId] = { ...node, fills: nextFills };
    changed = true;
  }
  return changed ? { ...document, nodes: nextNodes } : document;
}

/** Return the field value the inspector displays, including linked-cell defaults. */
export function patternFillFieldValue(
  document: Document,
  nodeId: NodeId,
  fillIndex: number,
  field: PatternNumericField,
): number | undefined {
  const node = document.nodes[nodeId];
  if (!node) return undefined;
  const fill = resolveNodePaints(
    node as unknown as Parameters<typeof resolveNodePaints>[0],
    document,
  )[fillIndex];
  if (fill?.type !== 'pattern' || !fill.pattern) return undefined;
  const pattern = fill.pattern;
  const definition = pattern.definitionId
    ? document.patternDefinitions?.[pattern.definitionId]
    : undefined;

  switch (field) {
    case 'gapX':
      return pattern.gapX ?? definition?.repeat.gapX ?? pattern.spacing ?? 0;
    case 'gapY':
      return pattern.gapY ?? definition?.repeat.gapY ?? pattern.spacing ?? 0;
    case 'rowShift':
      return (
        pattern.rowShift ??
        definition?.repeat.rowShift ??
        (pattern.arrangement === 'brick' || definition?.repeat.arrangement === 'brick' ? 0.5 : 0)
      );
    case 'columnShift':
      return (
        pattern.columnShift ??
        definition?.repeat.columnShift ??
        (pattern.arrangement === 'half-drop' || definition?.repeat.arrangement === 'half-drop'
          ? 0.5
          : 0)
      );
    case 'offsetX':
      return pattern.offsetX ?? definition?.repeat.originX ?? 0;
    case 'offsetY':
      return pattern.offsetY ?? definition?.repeat.originY ?? 0;
    case 'imageWidth':
      return pattern.imageWidth ?? definition?.cell.width ?? pattern.logicalWidth ?? 0;
    case 'imageHeight':
      return pattern.imageHeight ?? definition?.cell.height ?? pattern.logicalHeight ?? 0;
    case 'rotation':
      return pattern.rotation ?? 0;
  }
}

/** Apply an absolute value or relative gesture to each selected pattern slot. */
export function applyPatternFillFieldChange(
  document: Document,
  nodeIds: readonly NodeId[],
  fillIndex: number,
  field: PatternNumericField,
  change: PatternFillFieldChange,
): Document {
  if (
    (change.type === 'set' && change.value !== undefined && !Number.isFinite(change.value)) ||
    (change.type === 'delta' && !Number.isFinite(change.delta))
  ) {
    return document;
  }

  let nextNodes = document.nodes;
  let changed = false;
  for (const nodeId of nodeIds) {
    const node = nextNodes[nodeId];
    // Shared paints are edited through their own scope in the inspector. Keep
    // this batch helper defensive so it never turns a shared paint edit into a
    // per-object override by accident.
    if (!node || node.paintRefs?.length) continue;
    const fills = resolveNodePaints(
      node as unknown as Parameters<typeof resolveNodePaints>[0],
      document,
    );
    const fill = fills[fillIndex];
    if (fill?.type !== 'pattern' || !fill.pattern) continue;

    let value: number | undefined;
    if (change.type === 'set') value = change.value;
    else {
      const current = patternFillFieldValue(document, nodeId, fillIndex, field);
      if (current === undefined) continue;
      value = current + change.delta;
    }
    if (value !== undefined && !Number.isFinite(value)) continue;
    if (value !== undefined && (field === 'imageWidth' || field === 'imageHeight')) {
      value = Math.max(1, value);
    }
    if (value !== undefined && (field === 'rowShift' || field === 'columnShift')) {
      value = Math.min(8, Math.max(-8, value));
    }

    const nextPattern = { ...fill.pattern, [field]: value };
    if (Object.is(fill.pattern[field], nextPattern[field])) continue;
    const nextFills = [...fills];
    nextFills[fillIndex] = { ...fill, pattern: nextPattern };
    if (!changed) nextNodes = { ...document.nodes };
    nextNodes[nodeId] = { ...node, fills: nextFills };
    changed = true;
  }

  return changed ? { ...document, nodes: nextNodes } : document;
}

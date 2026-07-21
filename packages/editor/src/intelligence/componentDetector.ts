import type { Document, ManagedColor, NodeId, SceneNode } from '@strata/scene';

export interface DuplicateGroup {
  score: number;
  nodeIds: NodeId[];
  reason: string;
  suggestComponent: boolean;
}

interface FeatureVector {
  kind: string;
  widthPct: number;
  heightPct: number;
  fillType: string;
  strokeType: string;
  cornerRadius: number;
  childCount: number;
}

function extractFeatures(node: SceneNode, _doc: Document): FeatureVector | null {
  if (node.kind === 'group' || node.kind === 'frame') {
    const children = node.children ?? [];
    return {
      kind: node.kind,
      widthPct: (node as { w?: number }).w ?? 200,
      heightPct: (node as { h?: number }).h ?? 160,
      fillType: fillTypeOf(node),
      strokeType: strokeTypeOf(node),
      cornerRadius: 0,
      childCount: children.length,
    };
  }
  if (node.kind === 'shape') {
    const shape = node.shape;
    const w = 'w' in shape ? (shape.w as number) : 200;
    const h = 'h' in shape ? (shape.h as number) : 160;
    return {
      kind: shape.kind,
      widthPct: w,
      heightPct: h,
      fillType: fillTypeOf(node),
      strokeType: strokeTypeOf(node),
      cornerRadius:
        'cornerRadius' in shape
          ? typeof shape.cornerRadius === 'number'
            ? shape.cornerRadius
            : ((shape.cornerRadius as number[])?.[0] ?? 0)
          : 0,
      childCount: 0,
    };
  }
  if (node.kind === 'text') {
    return {
      kind: 'text',
      widthPct: (node.text?.length ?? 1) * (node.fontSize ?? 16) * 0.6,
      heightPct: (node.fontSize ?? 16) * 1.2,
      fillType: fillTypeOf(node),
      strokeType: strokeTypeOf(node),
      cornerRadius: 0,
      childCount: 0,
    };
  }
  return null;
}

function fillTypeOf(node: SceneNode): string {
  const fills = 'fills' in node ? (node.fills as { type?: string }[] | undefined) : undefined;
  if (fills && fills.length > 0) {
    const visible = fills[0]!!;
    return visible?.type ?? 'none';
  }
  const fill = 'fill' in node ? (node.fill as ManagedColor | undefined) : undefined;
  if (fill) return 'solid';
  return 'none';
}

function strokeTypeOf(node: SceneNode): string {
  const strokes =
    'strokes' in node ? (node.strokes as { visible?: boolean }[] | undefined) : undefined;
  if (strokes && strokes.length > 0) return 'present';
  return 'none';
}

function featuresSimilar(a: FeatureVector, b: FeatureVector): number {
  if (a.kind !== b.kind) return 0;

  let score = 0;
  const weights = { kind: 0.3, size: 0.2, fill: 0.2, stroke: 0.1, radius: 0.1, children: 0.1 };

  if (a.kind === b.kind) score += weights.kind;

  const _maxDim = Math.max(a.widthPct, a.heightPct, b.widthPct, b.heightPct, 1); // used for normalization
  void _maxDim;
  const wRatio =
    a.widthPct > 0 && b.widthPct > 0
      ? Math.min(a.widthPct, b.widthPct) / Math.max(a.widthPct, b.widthPct)
      : 0;
  const hRatio =
    a.heightPct > 0 && b.heightPct > 0
      ? Math.min(a.heightPct, b.heightPct) / Math.max(a.heightPct, b.heightPct)
      : 0;
  if (wRatio >= 0.85 && hRatio >= 0.85) score += weights.size;

  if (a.fillType === b.fillType) score += weights.fill;
  if (a.strokeType === b.strokeType) score += weights.stroke;

  if (a.cornerRadius === b.cornerRadius || Math.abs(a.cornerRadius - b.cornerRadius) <= 2) {
    score += weights.radius;
  }

  if (a.childCount === b.childCount) score += weights.children;

  return Math.min(1, score);
}

export function findDuplicateStructures(doc: Document): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const processed = new Set<string>();

  const nodeEntries = Object.entries(doc.nodes)
    .map(([id, node]) => ({ id, node, features: extractFeatures(node, doc) }))
    .filter(
      (entry): entry is { id: string; node: SceneNode; features: FeatureVector } =>
        entry.features !== null,
    );

  for (let i = 0; i < nodeEntries.length; i++) {
    const a = nodeEntries[i]!;
    if (processed.has(a.id)) continue;

    const matches: string[] = [a.id];
    for (let j = i + 1; j < nodeEntries.length; j++) {
      const b = nodeEntries[j]!;
      if (processed.has(b.id)) continue;
      const score = featuresSimilar(a.features, b.features);
      if (score >= 0.7) {
        matches.push(b.id);
        processed.add(b.id);
      }
    }

    if (matches.length >= 2) {
      processed.add(a.id);
      groups.push({
        score: featuresSimilar(a.features, a.features),
        nodeIds: matches,
        reason: `Found ${matches.length} ${a.features.kind} nodes with similar properties`,
        suggestComponent: matches.length >= 3,
      });
    }
  }

  return groups;
}

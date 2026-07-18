import type { Document, Fill, NodeId, SceneNode } from '@strata/scene';

export interface VariantCandidate {
  nodeIds: NodeId[];
  differingProperties: Array<{
    property: string;
    values: string[];
  }>;
  suggestedVariantName: string;
  score: number;
}

interface StructuralSignature {
  kind: string;
  childKinds: string[];
  childCount: number;
}

function structuralSignature(node: SceneNode, doc: Document): StructuralSignature | null {
  if (node.kind === 'group' || node.kind === 'frame') {
    const children = node.children ?? [];
    const childKinds: string[] = [];
    for (const cid of children) {
      const child = doc.nodes[cid];
      if (child) childKinds.push(child.kind);
    }
    return { kind: node.kind, childKinds, childCount: children.length };
  }
  if (node.kind === 'shape') {
    return { kind: `shape:${node.shape.kind}`, childKinds: [], childCount: 0 };
  }
  if (node.kind === 'text') {
    return { kind: 'text', childKinds: [], childCount: 0 };
  }
  return null;
}

function compareProperties(
  a: SceneNode,
  b: SceneNode,
): Array<{ property: string; aValue: string; bValue: string }> {
  const diffs: Array<{ property: string; aValue: string; bValue: string }> = [];

  const aW = 'w' in a ? (a as { w: number }).w : undefined;
  const bW = 'w' in b ? (b as { w: number }).w : undefined;
  if (aW !== undefined && bW !== undefined && Math.abs(aW - bW) > 1) {
    diffs.push({ property: 'width', aValue: String(aW), bValue: String(bW) });
  }

  const aH = 'h' in a ? (a as { h: number }).h : undefined;
  const bH = 'h' in b ? (b as { h: number }).h : undefined;
  if (aH !== undefined && bH !== undefined && Math.abs(aH - bH) > 1) {
    diffs.push({ property: 'height', aValue: String(aH), bValue: String(bH) });
  }

  const aFill = fillKey(a);
  const bFill = fillKey(b);
  if (aFill !== bFill) {
    diffs.push({ property: 'fill', aValue: aFill, bValue: bFill });
  }

  if (a.kind === 'text' && b.kind === 'text') {
    const aT = 'text' in a ? (a as { text: string }).text : '';
    const bT = 'text' in b ? (b as { text: string }).text : '';
    if (aT !== bT) {
      diffs.push({ property: 'textContent', aValue: aT, bValue: bT });
    }

    const aFs = (a as { fontSize: number }).fontSize;
    const bFs = (b as { fontSize: number }).fontSize;
    if (aFs !== undefined && bFs !== undefined && aFs !== bFs) {
      diffs.push({ property: 'fontSize', aValue: String(aFs), bValue: String(bFs) });
    }
  }

  return diffs;
}

function fillKey(node: SceneNode): string {
  if ('fills' in node) {
    const fills = node.fills as Fill[] | undefined;
    if (fills && fills.length > 0) {
      const visible = fills.find((f) => f.visible !== false);
      if (visible) {
        if (visible.type === 'solid' && visible.color) {
          const c = visible.color;
          if (c.space === 'rgb') return `rgb:${c.r},${c.g},${c.b}`;
          if (c.space === 'cmyk') return `cmyk:${c.c},${c.m},${c.y},${c.k}`;
        }
        return visible.type;
      }
    }
  }
  if ('fill' in node) {
    const f = node.fill as { space?: string; r?: number; g?: number; b?: number };
    if (f && typeof f === 'object' && f.space === 'rgb' && f.r !== undefined) {
      return `rgb:${f.r},${f.g},${f.b}`;
    }
  }
  return 'none';
}

function signaturesSimilar(a: StructuralSignature, b: StructuralSignature): boolean {
  if (a.kind !== b.kind) return false;
  if (a.childCount !== b.childCount) return false;
  if (a.childKinds.length !== b.childKinds.length) return false;
  for (let i = 0; i < a.childKinds.length; i++) {
    if (a.childKinds[i] !== b.childKinds[i]) return false;
  }
  return true;
}

export function detectVariantCandidates(doc: Document): VariantCandidate[] {
  const candidates: VariantCandidate[] = [];
  const processed = new Set<NodeId>();

  const entries = Object.entries(doc.nodes)
    .map(([id, node]) => ({ id, node, sig: structuralSignature(node, doc) }))
    .filter((e): e is { id: string; node: SceneNode; sig: StructuralSignature } => e.sig !== null);

  for (let i = 0; i < entries.length; i++) {
    const a = entries[i];
    if (processed.has(a.id)) continue;

    const group: typeof entries = [a];
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j];
      if (processed.has(b.id)) continue;
      if (signaturesSimilar(a.sig, b.sig)) {
        group.push(b);
        processed.add(b.id);
      }
    }
    if (group.length < 2) continue;
    processed.add(a.id);

    const allDiffs: Map<string, string[]> = new Map();
    const ref = group[0].node;

    for (const entry of group) {
      const nodeDiffs = compareProperties(ref, entry.node);
      for (const d of nodeDiffs) {
        if (!allDiffs.has(d.property)) {
          allDiffs.set(d.property, [d.aValue]);
        }
        const vals = allDiffs.get(d.property)!;
        if (!vals.includes(d.bValue)) {
          vals.push(d.bValue);
        }
      }
    }

    const differingProperties = Array.from(allDiffs.entries())
      .filter(([, vals]) => vals.length >= 2)
      .map(([property, values]) => ({ property, values }));

    if (differingProperties.length < 1 || differingProperties.length > 3) continue;

    const score = Math.round((1 - differingProperties.length * 0.2) * 100);
    const firstProp = differingProperties[0].property;
    const suggestedVariantName =
      {
        fill: 'state',
        width: 'size',
        height: 'size',
        fontSize: 'size',
        textContent: 'label',
      }[firstProp] ?? firstProp;

    candidates.push({
      nodeIds: group.map((e) => e.id),
      differingProperties,
      suggestedVariantName,
      score,
    });
  }

  return candidates;
}

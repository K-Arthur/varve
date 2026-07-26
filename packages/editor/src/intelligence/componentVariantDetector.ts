import type { Document, Effect, Fill, NodeId, SceneNode, Stroke } from '@strata/scene';
import { getParent } from '@strata/scene';

export interface VariantCandidateMemberDetail {
  nodeId: NodeId;
  name: string;
  page: string | null;
}

export interface VariantCandidate {
  nodeIds: NodeId[];
  differingProperties: Array<{
    property: string;
    values: string[];
    confidence?: number;
  }>;
  suggestedVariantName: string;
  score: number;
  groupName: string;
  memberDetails: VariantCandidateMemberDetail[];
  identicalProperties: string[];
  tier: 'variant' | 'near-duplicate';
}

interface StructuralSignature {
  kind: string;
  childKinds: string[];
  childCount: number;
}

function findPageForNode(doc: Document, nodeId: NodeId): string | null {
  if (!doc.pages) return null;
  let current: NodeId | null = nodeId;
  while (current) {
    for (const page of doc.pages) {
      if (current === page.contentRoot) return page.name;
    }
    current = getParent(doc, current);
  }
  if (doc.globalChildren?.includes(nodeId)) return 'Global';
  return null;
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

function signaturesSimilar(a: StructuralSignature, b: StructuralSignature): boolean {
  if (a.kind !== b.kind) return false;
  if (a.childCount !== b.childCount) return false;
  if (a.childKinds.length !== b.childKinds.length) return false;
  for (let i = 0; i < a.childKinds.length; i++) {
    if (a.childKinds[i] !== b.childKinds[i]) return false;
  }
  return true;
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

function strokeKey(node: SceneNode): string {
  const strokes = 'strokes' in node ? (node.strokes as Stroke[] | undefined) : undefined;
  if (!strokes || strokes.length === 0) return 'none';
  const visible = strokes.find((s: Stroke) => s.visible !== false);
  if (!visible) return 'none';
  const width = 'width' in visible ? visible.width : 0;
  const color =
    'color' in visible && visible.color && visible.color.space === 'rgb'
      ? `rgb:${(visible.color as { r: number; g: number; b: number }).r},${(visible.color as { r: number; g: number; b: number }).g},${(visible.color as { r: number; g: number; b: number }).b}`
      : 'unknown';
  return `stroke:${width}:${color}`;
}

function effectsKey(node: SceneNode): string {
  const effects = 'effects' in node ? (node.effects as Effect[] | undefined) : undefined;
  if (!effects || effects.length === 0) return 'none';
  const visible = effects.filter((e: Effect) => e.visible !== false);
  if (visible.length === 0) return 'none';
  return visible
    .map((e: Effect) => {
      if (e.type === 'dropShadow') return `ds:${e.offsetX ?? 0},${e.offsetY ?? 0},${e.radius ?? 0}`;
      if (e.type === 'innerShadow')
        return `is:${e.offsetX ?? 0},${e.offsetY ?? 0},${e.radius ?? 0}`;
      if (e.type === 'layerBlur') return `lb:${e.radius ?? 0}`;
      if (e.type === 'backgroundBlur') return `bb:${e.radius ?? 0}`;
      return e.type;
    })
    .join('|');
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

  const aStroke = strokeKey(a);
  const bStroke = strokeKey(b);
  if (aStroke !== bStroke) {
    diffs.push({ property: 'stroke', aValue: aStroke, bValue: bStroke });
  }

  const aOpacity = 'opacity' in a ? (a as { opacity: number }).opacity : 1;
  const bOpacity = 'opacity' in b ? (b as { opacity: number }).opacity : 1;
  if (Math.abs(aOpacity - bOpacity) > 0.01) {
    diffs.push({ property: 'opacity', aValue: String(aOpacity), bValue: String(bOpacity) });
  }

  const aEffects = effectsKey(a);
  const bEffects = effectsKey(b);
  if (aEffects !== bEffects) {
    diffs.push({ property: 'effects', aValue: aEffects, bValue: bEffects });
  }

  if ((a.kind === 'frame' || a.kind === 'shape') && (b.kind === 'frame' || b.kind === 'shape')) {
    const aCr =
      'cornerRadius' in a ? (a as { cornerRadius?: number | number[] }).cornerRadius : undefined;
    const bCr =
      'cornerRadius' in b ? (b as { cornerRadius?: number | number[] }).cornerRadius : undefined;
    const aCrVal = Array.isArray(aCr) ? aCr[0] : (aCr ?? 0);
    const bCrVal = Array.isArray(bCr) ? bCr[0] : (bCr ?? 0);
    if (Math.abs(aCrVal - bCrVal) > 1) {
      diffs.push({ property: 'cornerRadius', aValue: String(aCrVal), bValue: String(bCrVal) });
    }
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

function inferGroupName(nodeIds: NodeId[], doc: Document): string {
  const names: string[] = [];
  for (const nid of nodeIds) {
    const node = doc.nodes[nid];
    if (node) names.push(node.name);
  }

  const commonPrefix = longestCommonPrefix(names);
  const stripped = commonPrefix.replace(/\s*\d+$/, '').trim();
  if (stripped && stripped.length > 1) return stripped;

  const textContents: string[] = [];
  for (const nid of nodeIds) {
    const node = doc.nodes[nid];
    if (node?.kind === 'text' && 'text' in node) {
      textContents.push((node as { text: string }).text);
    }
  }
  if (textContents.length > 0) {
    const commonText = longestCommonPrefix(textContents);
    if (commonText && commonText.length > 1) return commonText.trim();
  }

  return names[0]?.replace(/\s*\d+$/, '').trim() ?? 'Component Set';
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0] ?? '';
  for (let i = 1; i < strings.length; i++) {
    const s = strings[i] ?? '';
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix === '') break;
  }
  return prefix;
}

export function detectVariantCandidates(doc: Document): VariantCandidate[] {
  const candidates: VariantCandidate[] = [];
  const processed = new Set<NodeId>();

  const entries = Object.entries(doc.nodes)
    .map(([id, node]) => ({ id, node, sig: structuralSignature(node, doc) }))
    .filter((e): e is { id: string; node: SceneNode; sig: StructuralSignature } => e.sig !== null);

  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!;
    if (processed.has(a.id)) continue;

    const group: typeof entries = [a];
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      if (processed.has(b.id)) continue;
      if (signaturesSimilar(a.sig, b.sig)) {
        group.push(b);
        processed.add(b.id);
      }
    }
    if (group.length < 2) continue;
    processed.add(a.id);

    const allDiffs: Map<string, string[]> = new Map();
    const ref = group[0]!.node;

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
    const firstProp = differingProperties[0]!.property;
    const suggestedVariantName =
      {
        fill: 'state',
        width: 'size',
        height: 'size',
        fontSize: 'size',
        textContent: 'label',
      }[firstProp] ?? firstProp;

    const memberDetails: VariantCandidateMemberDetail[] = group.map((e) => ({
      nodeId: e.id,
      name: e.node.name ?? '',
      page: findPageForNode(doc, e.id),
    }));

    const nodeIds = group.map((e) => e.id);
    const groupName = inferGroupName(nodeIds, doc);

    const allComparedProperties = new Set<string>();
    for (const entry of group) {
      const nodeDiffs = compareProperties(ref, entry.node);
      for (const d of nodeDiffs) allComparedProperties.add(d.property);
    }
    const identicalProperties: string[] = [];
    const checkProperties = [
      'width',
      'height',
      'fill',
      'stroke',
      'opacity',
      'effects',
      'cornerRadius',
      'textContent',
      'fontSize',
    ];
    for (const prop of checkProperties) {
      if (!allComparedProperties.has(prop)) identicalProperties.push(prop);
    }

    candidates.push({
      nodeIds,
      differingProperties: differingProperties.map((dp) => ({
        ...dp,
        confidence: 1 - (dp.values.length - 1) * 0.15,
      })),
      suggestedVariantName,
      score,
      groupName,
      memberDetails,
      identicalProperties,
      tier: 'variant',
    });
  }

  return candidates;
}

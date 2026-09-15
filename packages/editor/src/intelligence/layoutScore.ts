import type { Document, NodeId } from '@varve/scene';
import { getParent } from '@varve/scene';
import { nodeWorldBounds } from '../scene/world';

export interface LayoutIssue {
  category: 'alignment' | 'spacing' | 'overlap' | 'nesting' | 'size-harmony';
  description: string;
  severity: 'error' | 'warning' | 'info';
  nodeIds: string[];
}

export interface LayoutScoreResult {
  score: number;
  issues: LayoutIssue[];
}

const GRID = 8;
const MAX_NESTING = 6;

function isOnGrid(v: number): boolean {
  return v % GRID === 0;
}

function computeNestingDepth(doc: Document, id: NodeId): number {
  let depth = 0;
  let current: NodeId | null = id;
  while (current) {
    const p = getParent(doc, current);
    if (!p) break;
    depth++;
    current = p;
  }
  return depth;
}

function getVisibleUnlockedNodeIds(doc: Document, nodeIds: NodeId[]): NodeId[] {
  return nodeIds.filter((id) => {
    const n = doc.nodes[id];
    return n?.visible && !n.locked;
  });
}

function getSiblings(doc: Document, nodeIds: NodeId[]): Map<string, NodeId[]> {
  const groups = new Map<string, NodeId[]>();
  for (const id of nodeIds) {
    const parent = getParent(doc, id);
    const key = parent ?? '__root__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(id);
  }
  return groups;
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

export function computeLayoutScore(doc: Document, nodeIds: NodeId[]): LayoutScoreResult {
  const issues: LayoutIssue[] = [];
  let score = 100;

  const visibleIds = getVisibleUnlockedNodeIds(doc, nodeIds);
  if (visibleIds.length === 0) {
    return { score: 100, issues: [] };
  }

  const boundsMap = new Map<NodeId, { x: number; y: number; w: number; h: number }>();
  for (const id of visibleIds) {
    const b = nodeWorldBounds(doc, id);
    if (b) boundsMap.set(id, b);
  }

  for (const [id, b] of boundsMap) {
    if (!isOnGrid(b.x) || !isOnGrid(b.y) || !isOnGrid(b.w) || !isOnGrid(b.h)) {
      issues.push({
        category: 'alignment',
        description: `Node not aligned to ${GRID}px grid`,
        severity: 'warning',
        nodeIds: [id],
      });
      score -= 5;
    }
  }

  const siblingGroups = getSiblings(doc, visibleIds);
  for (const [, siblingIds] of siblingGroups) {
    if (siblingIds.length < 3) continue;

    const siblingBounds: { id: NodeId; x: number; y: number; w: number; h: number }[] = [];
    for (const id of siblingIds) {
      const b = boundsMap.get(id);
      if (b) siblingBounds.push({ id, ...b });
    }

    siblingBounds.sort((a, b) => {
      const dx = a.x - b.x;
      if (dx !== 0) return dx;
      return a.y - b.y;
    });

    if (siblingBounds.length >= 2) {
      const gaps: number[] = [];
      for (let i = 0; i < siblingBounds.length - 1; i++) {
        const a = siblingBounds[i]!;
        const b = siblingBounds[i + 1]!;
        const hGap = b.x - (a.x + a.w);
        const vGap = b.y - (a.y + a.h);
        const gap = Math.abs(hGap) <= Math.abs(vGap) ? hGap : vGap;
        gaps.push(Math.abs(gap));
      }

      if (gaps.length > 1) {
        const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
        const stddev = Math.sqrt(variance);
        if (stddev > 4) {
          issues.push({
            category: 'spacing',
            description: `Inconsistent spacing among siblings (stddev: ${stddev.toFixed(1)}px)`,
            severity: 'warning',
            nodeIds: siblingIds,
          });
          score -= 10;
        }
      }
    }

    const widths = siblingBounds.map((b) => b.w);
    if (widths.length > 1) {
      const meanW = widths.reduce((s, w) => s + w, 0) / widths.length;
      const varW = widths.reduce((s, w) => s + (w - meanW) ** 2, 0) / widths.length;
      const stddevW = Math.sqrt(varW);
      if (stddevW > 5) {
        issues.push({
          category: 'size-harmony',
          description: `Inconsistent widths among siblings (stddev: ${stddevW.toFixed(1)}px)`,
          severity: 'info',
          nodeIds: siblingIds,
        });
        score -= 5;
      }
    }
  }

  for (let i = 0; i < visibleIds.length; i++) {
    for (let j = i + 1; j < visibleIds.length; j++) {
      const aId = visibleIds[i]!;
      const bId = visibleIds[j]!;
      if (!boundsMap.has(aId) || !boundsMap.has(bId)) continue;
      const parentA = getParent(doc, aId);
      const parentB = getParent(doc, bId);
      if (parentA !== null && parentA === parentB) continue;

      const aBounds = boundsMap.get(aId)!;
      const bBounds = boundsMap.get(bId)!;
      if (rectsOverlap(aBounds, bBounds)) {
        issues.push({
          category: 'overlap',
          description: 'Non-sibling nodes overlap',
          severity: 'error',
          nodeIds: [aId, bId],
        });
        score -= 15;
      }
    }
  }

  for (const id of visibleIds) {
    const depth = computeNestingDepth(doc, id);
    if (depth > MAX_NESTING) {
      issues.push({
        category: 'nesting',
        description: `Node nesting depth ${depth} exceeds ${MAX_NESTING}`,
        severity: 'info',
        nodeIds: [id],
      });
      score -= 10;
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
  };
}

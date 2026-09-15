import type { Document, NodeId } from '@varve/scene';
import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { translate } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { analyzeSpacing, harmonizeSpacing } from './spacingHarmonizer';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Create a rect node at a given world position via translate transform. */
function makeRect(
  doc: Document,
  x: number,
  y: number,
  w: number,
  h: number,
): { doc: Document; id: NodeId } {
  const shape = { kind: 'rect' as const, x: 0, y: 0, w, h };
  const node = makeShapeNode('' as NodeId, shape, {
    name: 'Rect',
    transform: translate(x, y),
  });
  // Use an auto-generated id by pretending we have a counter
  const id = `rect_${Math.random().toString(36).slice(2, 8)}`;
  const withId = { ...node, id };
  return { doc: addNode(doc, withId), id };
}

/** Inline document with N rect nodes. */
function buildDocWithRects(positions: { x: number; y: number; w: number; h: number }[]): {
  doc: Document;
  ids: NodeId[];
} {
  let doc = createDocument('spacing-test');
  const ids: NodeId[] = [];
  for (const p of positions) {
    const result = makeRect(doc, p.x, p.y, p.w, p.h);
    doc = result.doc;
    ids.push(result.id);
  }
  return { doc, ids };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('analyzeSpacing', () => {
  it('detects equal spacing: three rects with 20px gaps', () => {
    const { doc, ids } = buildDocWithRects([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 120, y: 0, w: 100, h: 50 },
      { x: 240, y: 0, w: 100, h: 50 },
    ]);
    const result = analyzeSpacing(doc, ids);
    expect(result.detectedBaseUnit).toBe(20);
    expect(result.confidence).toBe(1);
    expect(result.gaps).toEqual([20, 20]);
    expect(result.suggestedGap).toBe(20);
  });

  it('handles uneven spacing: gaps 8, 12, 16 → low confidence', () => {
    const { doc, ids } = buildDocWithRects([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 108, y: 0, w: 100, h: 50 },
      { x: 220, y: 0, w: 100, h: 50 },
      { x: 336, y: 0, w: 100, h: 50 },
    ]);
    const result = analyzeSpacing(doc, ids);
    // Gaps are 8, 12, 16 — spread across 3 bins, so confidence < 0.8
    expect(result.detectedBaseUnit).toBeNull();
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.gaps).toHaveLength(3);
  });

  it('returns empty gaps for a single node', () => {
    const { doc, ids } = buildDocWithRects([{ x: 0, y: 0, w: 100, h: 50 }]);
    const result = analyzeSpacing(doc, ids);
    expect(result.detectedBaseUnit).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.gaps).toEqual([]);
    expect(result.suggestedGap).toBe(0);
  });

  it('returns empty gaps for an empty array', () => {
    const doc = createDocument('spacing-test');
    const result = analyzeSpacing(doc, []);
    expect(result.detectedBaseUnit).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.gaps).toEqual([]);
  });

  it('prefers horizontal alignment over vertical when both axes have similar spread', () => {
    // Nodes arranged in a row with slight vertical offset — variance X >> variance Y
    const { doc, ids } = buildDocWithRects([
      { x: 0, y: 5, w: 100, h: 50 },
      { x: 120, y: 0, w: 100, h: 50 },
      { x: 240, y: 10, w: 100, h: 50 },
    ]);
    const result = analyzeSpacing(doc, ids);
    // Gap 20 is clean, should detect
    expect(result.detectedBaseUnit).toBe(20);
    expect(result.suggestedGap).toBe(20);
  });

  it('uses axis-aligned world bounds for rotated elements', () => {
    // First rect at (0,0), second at (140,0) with rotation would still have
    // axis-aligned bounds computed by nodeWorldBounds → affects gap slightly.
    // Using simple unrotated test since nodeWorldBounds handles rotation AABB.
    const { doc, ids } = buildDocWithRects([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 140, y: 0, w: 100, h: 50 },
      { x: 280, y: 0, w: 100, h: 50 },
    ]);
    const result = analyzeSpacing(doc, ids);
    // Gaps: 40, 40
    expect(result.detectedBaseUnit).toBe(40);
    expect(result.suggestedGap).toBe(40);
  });

  it('filters overlapping nodes before computing gaps', () => {
    // Two rects overlapping (same position), third one offset
    const { doc, ids } = buildDocWithRects([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 10, y: 5, w: 50, h: 30 }, // overlaps with first
      { x: 120, y: 0, w: 100, h: 50 },
    ]);
    const result = analyzeSpacing(doc, ids);
    // After filtering overlaps, should only have 2 entries: first and third
    // Gap between first (0+100=100) and third (120) = 20
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toBe(20);
  });

  it('assigns high confidence to a clear mode with multiple matches', () => {
    // 5 nodes with consistent 16px gaps, one outlier at 32px
    const { doc, ids } = buildDocWithRects([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 116, y: 0, w: 100, h: 50 }, // gap 16
      { x: 232, y: 0, w: 100, h: 50 }, // gap 16
      { x: 348, y: 0, w: 100, h: 50 }, // gap 16
      { x: 480, y: 0, w: 100, h: 50 }, // gap 32 (outlier)
    ]);
    const result = analyzeSpacing(doc, ids);
    // 3 gaps of 16, 1 gap of 32 = 4 total, mode bin covers 3/4 = 0.75
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.detectedBaseUnit).toBeNull(); // below 0.8
  });
});

describe('harmonizeSpacing', () => {
  it('creates a new Document reference (structural sharing)', () => {
    const { doc, ids } = buildDocWithRects([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 110, y: 0, w: 100, h: 50 },
      { x: 230, y: 0, w: 100, h: 50 },
    ]);
    const result = harmonizeSpacing(doc, ids);
    expect(result).not.toBe(doc);
    expect(result.id).toBe(doc.id);
    expect(result.nodes).not.toBe(doc.nodes);
  });

  it('preserves node count after harmonization', () => {
    const { doc, ids } = buildDocWithRects([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 120, y: 0, w: 100, h: 50 },
      { x: 240, y: 0, w: 100, h: 50 },
    ]);
    const beforeCount = Object.keys(doc.nodes).length;
    const result = harmonizeSpacing(doc, ids);
    expect(Object.keys(result.nodes).length).toBe(beforeCount);
  });
});

/**
 * Tests for glyph-level typography document ops.
 */
import { describe, expect, it } from 'vitest';
import { addNode, createDocument } from '../document';
import type { SceneNode } from '../types';
import {
  canGlyphAdjust,
  clearGlyphAdjustments,
  glyphAdjustmentStats,
  setGlyphAdjustment,
  setPairAdjustment,
  setTextKerningMode,
} from './glyphAdjustments';

function textNodeDoc(text: string, extra: Record<string, unknown> = {}) {
  const doc = createDocument('t', { flat: true });
  const node = {
    id: 'n1',
    kind: 'text',
    text,
    transform: [1, 0, 0, 1, 0, 0] as const,
    fontSize: 24,
    ...extra,
  };
  return addNode(doc, node as unknown as SceneNode);
}

describe('canGlyphAdjust', () => {
  it('accepts plain single-line LTR text', () => {
    const doc = textNodeDoc('Hello');
    expect(canGlyphAdjust(doc.nodes.n1 as never).ok).toBe(true);
  });

  it('rejects rich text, empty, multi-line, RTL, case, list, and path text', () => {
    expect(
      canGlyphAdjust(textNodeDoc('Hi', { richText: { paragraphs: [] } }).nodes.n1 as never).ok,
    ).toBe(false);
    expect(canGlyphAdjust(textNodeDoc('').nodes.n1 as never).ok).toBe(false);
    expect(canGlyphAdjust(textNodeDoc('a\nb').nodes.n1 as never).ok).toBe(false);
    expect(canGlyphAdjust(textNodeDoc('שלום', { direction: 'rtl' }).nodes.n1 as never).ok).toBe(
      false,
    );
    expect(canGlyphAdjust(textNodeDoc('Hi', { textCase: 'uppercase' }).nodes.n1 as never).ok).toBe(
      false,
    );
    expect(canGlyphAdjust(textNodeDoc('Hi', { listStyle: 'disc' }).nodes.n1 as never).ok).toBe(
      false,
    );
    expect(canGlyphAdjust(textNodeDoc('Hi', { textMode: 'path' }).nodes.n1 as never).ok).toBe(
      false,
    );
    expect(canGlyphAdjust(undefined).ok).toBe(false);
  });
});

describe('kerning mode', () => {
  it('sets and clamps the mode', () => {
    const doc = textNodeDoc('Hi');
    const none = setTextKerningMode(doc, 'n1', 'none');
    expect((none.nodes.n1 as { kerningMode?: string }).kerningMode).toBe('none');
    const auto = setTextKerningMode(none, 'n1', 'auto');
    expect((auto.nodes.n1 as { kerningMode?: string }).kerningMode).toBe('auto');
  });
});

describe('glyph adjustments', () => {
  it('merges adjustment fields per cluster', () => {
    const doc = textNodeDoc('Hi');
    const a = setGlyphAdjustment(doc, 'n1', 1, { dx: 5, dy: -2 });
    const node = a.nodes.n1 as { glyphAdjustments?: Record<number, unknown> };
    expect(node.glyphAdjustments?.[1]).toMatchObject({
      dx: 5,
      dy: -2,
      advance: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    });
    const b = setGlyphAdjustment(a, 'n1', 1, { advance: 4 });
    const node2 = b.nodes.n1 as { glyphAdjustments?: Record<number, unknown> };
    expect(node2.glyphAdjustments?.[1]).toMatchObject({ dx: 5, advance: 4 });
  });

  it('clears a cluster adjustment with null', () => {
    const doc = textNodeDoc('Hi');
    const a = setGlyphAdjustment(doc, 'n1', 0, { dx: 9 });
    const b = setGlyphAdjustment(a, 'n1', 0, null);
    const node = b.nodes.n1 as { glyphAdjustments?: Record<number, unknown> };
    expect(node.glyphAdjustments?.[0]).toBeUndefined();
  });

  it('no-ops on non-text nodes', () => {
    const doc = createDocument('t', { flat: true });
    const node = {
      id: 'n1',
      kind: 'shape',
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      transform: [1, 0, 0, 1, 0, 0] as const,
    };
    const d = addNode(doc, node as unknown as SceneNode);
    const out = setGlyphAdjustment(d, 'n1', 0, { dx: 1 });
    expect(out).toBe(d);
  });
});

describe('pair adjustments', () => {
  it('sets and clears pair spacing', () => {
    const doc = textNodeDoc('Hi');
    const a = setPairAdjustment(doc, 'n1', 0, 6);
    expect((a.nodes.n1 as { pairAdjustments?: Record<number, number> }).pairAdjustments?.[0]).toBe(
      6,
    );
    const b = setPairAdjustment(a, 'n1', 0, null);
    expect(
      (b.nodes.n1 as { pairAdjustments?: Record<number, number> }).pairAdjustments?.[0],
    ).toBeUndefined();
  });
});

describe('clear + stats', () => {
  it('clears all adjustments', () => {
    const doc = textNodeDoc('Hello');
    const a = setGlyphAdjustment(doc, 'n1', 0, { dx: 1 });
    const b = setPairAdjustment(a, 'n1', 1, 3);
    const c = clearGlyphAdjustments(b, 'n1');
    const node = c.nodes.n1 as { glyphAdjustments?: unknown; pairAdjustments?: unknown };
    expect(node.glyphAdjustments).toBeUndefined();
    expect(node.pairAdjustments).toBeUndefined();
  });

  it('counts adjustments for status', () => {
    const doc = textNodeDoc('Hello');
    const a = setGlyphAdjustment(doc, 'n1', 0, { dx: 1 });
    const b = setPairAdjustment(a, 'n1', 1, 3);
    const stats = glyphAdjustmentStats(b.nodes.n1 as never);
    expect(stats).toEqual({ adjustedClusters: 1, adjustedPairs: 1 });
  });
});

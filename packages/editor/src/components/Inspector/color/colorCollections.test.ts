/**
 * Tests for colorCollections — document color extraction and recent color management.
 */
import { createDocument, type Document, makeShapeNode, nextNodeId, solidFill } from '@strata/scene';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addRecentColor, extractDocumentColors, getRecentColors } from './colorCollections';

describe('colorCollections', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('extractDocumentColors', () => {
    it('returns empty array for empty document', () => {
      const doc = createDocument('Empty');
      expect(extractDocumentColors(doc)).toEqual([]);
    });

    it('extracts colors from node fills', () => {
      let doc = createDocument('Test');
      const r = nextNodeId(doc);
      doc = r.doc;
      const shape = makeShapeNode(r.id, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
      shape.fills = [
        solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 }),
        solidFill({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 }),
      ];
      doc = { ...doc, nodes: { ...doc.nodes, [shape.id]: shape } };
      const colors = extractDocumentColors(doc);
      expect(colors).toHaveLength(2);
      expect(colors[0]).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
      expect(colors[1]).toEqual({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 });
    });

    it('deduplicates identical colors', () => {
      let doc = createDocument('Test');
      const r1 = nextNodeId(doc);
      doc = r1.doc;
      const shape1 = makeShapeNode(r1.id, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
      shape1.fills = [solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 })];
      const r2 = nextNodeId(doc);
      doc = r2.doc;
      const shape2 = makeShapeNode(r2.id, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
      shape2.fills = [solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 })];
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [shape1.id]: shape1, [shape2.id]: shape2 },
      } as Document;
      const colors = extractDocumentColors(doc);
      expect(colors).toHaveLength(1);
    });
  });

  describe('recent colors', () => {
    it('returns empty array when no recent colors stored', () => {
      expect(getRecentColors()).toEqual([]);
    });

    it('stores and retrieves recent colors', () => {
      addRecentColor({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
      const recent = getRecentColors();
      expect(recent).toHaveLength(1);
      expect(recent[0]).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    });

    it('deduplicates and moves most recent to front', () => {
      addRecentColor({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
      addRecentColor({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 });
      addRecentColor({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 }); // duplicate
      const recent = getRecentColors();
      expect(recent).toHaveLength(2);
      expect(recent[0]).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 }); // most recent first
    });

    it('caps at 16 colors', () => {
      for (let i = 0; i < 20; i++) {
        addRecentColor({ space: 'rgb' as const, r: i, g: i, b: i, a: 255 });
      }
      const recent = getRecentColors();
      expect(recent.length).toBeLessThanOrEqual(16);
    });
  });
});

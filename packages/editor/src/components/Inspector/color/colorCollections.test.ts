/**
 * Tests for colorCollections — document color extraction and recent color management.
 */
import { createDocument, makeShapeNode, solidFill } from '@strata/scene';
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
      const shape = makeShapeNode('Rect', { x: 0, y: 0, width: 100, height: 100 }, 'rect');
      shape.fills = [solidFill([255, 0, 0, 255]), solidFill([0, 255, 0, 255])];
      doc = { ...doc, nodes: { ...doc.nodes, [shape.id]: shape } };
      const colors = extractDocumentColors(doc);
      expect(colors).toHaveLength(2);
      expect(colors[0]).toEqual([255, 0, 0, 255]);
      expect(colors[1]).toEqual([0, 255, 0, 255]);
    });

    it('deduplicates identical colors', () => {
      let doc = createDocument('Test');
      const shape1 = makeShapeNode('R1', { x: 0, y: 0, width: 50, height: 50 }, 'rect');
      shape1.fills = [solidFill([255, 0, 0, 255])];
      const shape2 = makeShapeNode('R2', { x: 50, y: 0, width: 50, height: 50 }, 'rect');
      shape2.fills = [solidFill([255, 0, 0, 255])];
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [shape1.id]: shape1, [shape2.id]: shape2 },
      };
      const colors = extractDocumentColors(doc);
      expect(colors).toHaveLength(1);
    });
  });

  describe('recent colors', () => {
    it('returns empty array when no recent colors stored', () => {
      expect(getRecentColors()).toEqual([]);
    });

    it('stores and retrieves recent colors', () => {
      addRecentColor([255, 0, 0, 255]);
      const recent = getRecentColors();
      expect(recent).toHaveLength(1);
      expect(recent[0]).toEqual([255, 0, 0, 255]);
    });

    it('deduplicates and moves most recent to front', () => {
      addRecentColor([255, 0, 0, 255]);
      addRecentColor([0, 255, 0, 255]);
      addRecentColor([255, 0, 0, 255]); // duplicate
      const recent = getRecentColors();
      expect(recent).toHaveLength(2);
      expect(recent[0]).toEqual([255, 0, 0, 255]); // most recent first
    });

    it('caps at 16 colors', () => {
      for (let i = 0; i < 20; i++) {
        addRecentColor([i, i, i, 255]);
      }
      const recent = getRecentColors();
      expect(recent.length).toBeLessThanOrEqual(16);
    });
  });
});

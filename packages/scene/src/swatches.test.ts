import { describe, expect, it } from 'vitest';
import type { ManagedColor } from './colorManagement';
import { createDocument, makeShapeNode, nextNodeId } from './document';
import {
  addSwatch,
  addSwatch as addSwatchBasic,
  addSwatches,
  applySwatchToNode,
  hexToManagedColor,
  managedColorToHex,
  paletteToSwatches,
  removeSwatch,
  removeSwatches,
  renameSwatch,
  reorderSwatches,
  swatchesToPalette,
  updateSwatch,
} from './swatches';

const red: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
const blue: ManagedColor = { space: 'rgb', r: 0, g: 0, b: 255, a: 255 };

describe('swatches', () => {
  describe('addSwatch', () => {
    it('adds a named swatch to the document', () => {
      const doc = createDocument();
      const result = addSwatch(doc, 'Red', red);
      expect(result.swatches).toBeDefined();
      expect(result.swatches?.length).toBe(1);
      expect(result.swatches?.[0]?.name).toBe('Red');
      expect(result.swatches?.[0]?.color).toEqual(red);
    });

    it('adds multiple swatches', () => {
      let doc = createDocument();
      doc = addSwatch(doc, 'Red', red);
      doc = addSwatch(doc, 'Blue', blue);
      expect(doc.swatches?.length).toBe(2);
    });

    it('each swatch has a unique id', () => {
      const doc = createDocument();
      const r1 = addSwatch(doc, 'Red', red);
      const r2 = addSwatch(doc, 'Blue', blue);
      expect(r1.swatches?.[0]?.id).not.toBe(r2.swatches?.[0]?.id);
    });
  });

  describe('removeSwatch', () => {
    it('removes a swatch by id', () => {
      let doc = createDocument();
      doc = addSwatch(doc, 'Red', red);
      doc = addSwatch(doc, 'Blue', blue);
      const id = doc.swatches?.[0]?.id as string;
      const result = removeSwatch(doc, id);
      expect(result.swatches?.length).toBe(1);
      expect(result.swatches?.[0]?.name).toBe('Blue');
    });

    it('returns unchanged for unknown id', () => {
      const doc = createDocument();
      const result = removeSwatch(doc, 'nonexistent');
      expect(result).toBe(doc);
    });
  });

  describe('updateSwatch', () => {
    it('updates a swatch color', () => {
      let doc = createDocument();
      doc = addSwatch(doc, 'Red', red);
      const id = doc.swatches?.[0]?.id as string;
      const result = updateSwatch(doc, id, blue);
      expect(result.swatches?.[0]?.color).toEqual(blue);
      expect(result.swatches?.[0]?.name).toBe('Red');
    });

    it('returns unchanged for unknown id', () => {
      const doc = createDocument();
      const result = updateSwatch(doc, 'nonexistent', blue);
      expect(result).toBe(doc);
    });
  });

  describe('applySwatchToNode', () => {
    it('sets node fill to swatch color', () => {
      let doc = createDocument();
      const { id: nid, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const shape = makeShapeNode(nid, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [nid]: shape },
        rootChildren: [...doc.rootChildren, nid],
      };
      doc = addSwatchBasic(doc, 'Red', red);
      const swatchId = doc.swatches?.[0]?.id as string;
      const result = applySwatchToNode(doc, nid, swatchId);
      expect(result.nodes[nid]?.fill).toEqual(red);
    });

    it('returns unchanged for unknown swatch id', () => {
      let doc = createDocument();
      const { id: nid, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const shape = makeShapeNode(nid, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [nid]: shape },
        rootChildren: [...doc.rootChildren, nid],
      };
      const result = applySwatchToNode(doc, nid, 'nonexistent');
      expect(result).toBe(doc);
    });

    it('returns unchanged for unknown node id', () => {
      let doc = createDocument();
      doc = addSwatchBasic(doc, 'Red', red);
      const result = applySwatchToNode(doc, 'nonexistent', doc.swatches?.[0]?.id as string);
      expect(result).toBe(doc);
    });
  });

  describe('renameSwatch', () => {
    it('renames a swatch', () => {
      let doc = createDocument();
      doc = addSwatchBasic(doc, 'Old Name', red);
      const id = doc.swatches?.[0]?.id as string;
      const result = renameSwatch(doc, id, 'New Name');
      expect(result.swatches?.[0]?.name).toBe('New Name');
    });

    it('returns unchanged for unknown id', () => {
      const doc = createDocument();
      expect(renameSwatch(doc, 'nonexistent', 'Name')).toBe(doc);
    });
  });

  describe('addSwatches (batch)', () => {
    it('adds multiple swatches at once', () => {
      const doc = createDocument();
      const result = addSwatches(doc, [
        { name: 'Red', color: red },
        { name: 'Blue', color: blue },
      ]);
      expect(result.swatches?.length).toBe(2);
      expect(result.swatches?.[0]?.name).toBe('Red');
      expect(result.swatches?.[1]?.name).toBe('Blue');
    });

    it('appends to existing swatches', () => {
      let doc = createDocument();
      doc = addSwatchBasic(doc, 'Existing', red);
      doc = addSwatches(doc, [{ name: 'New', color: blue }]);
      expect(doc.swatches?.length).toBe(2);
    });
  });

  describe('removeSwatches (batch)', () => {
    it('removes multiple swatches', () => {
      let doc = createDocument();
      doc = addSwatches(doc, [
        { name: 'A', color: red },
        { name: 'B', color: blue },
        { name: 'C', color: red },
      ]);
      const ids = doc.swatches!.slice(0, 2).map((s) => s.id);
      const result = removeSwatches(doc, ids);
      expect(result.swatches?.length).toBe(1);
      expect(result.swatches?.[0]?.name).toBe('C');
    });
  });

  describe('reorderSwatches', () => {
    it('moves a swatch from one position to another', () => {
      let doc = createDocument();
      doc = addSwatches(doc, [
        { name: 'A', color: red },
        { name: 'B', color: blue },
        { name: 'C', color: red },
      ]);
      const result = reorderSwatches(doc, 0, 2);
      expect(result.swatches?.map((s) => s.name)).toEqual(['B', 'C', 'A']);
    });

    it('returns unchanged for out-of-bounds index', () => {
      let doc = createDocument();
      doc = addSwatchBasic(doc, 'A', red);
      expect(reorderSwatches(doc, 0, 5)).toBe(doc);
      expect(reorderSwatches(doc, 5, 0)).toBe(doc);
    });
  });

  describe('managedColorToHex', () => {
    it('converts RGB to hex', () => {
      expect(managedColorToHex({ space: 'rgb', r: 255, g: 128, b: 0, a: 255 })).toBe('#ff8000');
    });

    it('converts CMYK to approximate hex', () => {
      const hex = managedColorToHex({ space: 'cmyk', c: 0, m: 255, y: 255, k: 0, a: 255 });
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('converts gray to hex', () => {
      expect(managedColorToHex({ space: 'gray', v: 128, a: 255 })).toBe('#808080');
    });
  });

  describe('hexToManagedColor', () => {
    it('parses hex to RGB ManagedColor', () => {
      const color = hexToManagedColor('#ff8000');
      expect(color).toEqual({ space: 'rgb', r: 255, g: 128, b: 0, a: 255 });
    });

    it('handles hex without #', () => {
      const color = hexToManagedColor('00ff00');
      expect(color).toEqual({ space: 'rgb', r: 0, g: 255, b: 0, a: 255 });
    });
  });

  describe('swatchesToPalette', () => {
    it('converts swatches to hex array', () => {
      let doc = createDocument();
      doc = addSwatches(doc, [
        { name: 'Red', color: red },
        { name: 'Blue', color: blue },
      ]);
      const palette = swatchesToPalette(doc.swatches!);
      expect(palette).toEqual(['#ff0000', '#0000ff']);
    });
  });

  describe('paletteToSwatches', () => {
    it('creates swatches from hex palette', () => {
      const doc = createDocument();
      const result = paletteToSwatches(doc, ['#ff0000', '#00ff00', '#0000ff'], 'Extracted');
      expect(result.swatches?.length).toBe(3);
      expect(result.swatches?.[0]?.name).toBe('Extracted 1');
      expect(result.swatches?.[1]?.name).toBe('Extracted 2');
      expect(result.swatches?.[2]?.name).toBe('Extracted 3');
    });
  });
});

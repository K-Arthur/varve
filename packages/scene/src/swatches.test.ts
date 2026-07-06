import { describe, expect, it } from 'vitest';
import type { ManagedColor } from './colorManagement';
import { createDocument, makeShapeNode, nextNodeId } from './document';
import { addSwatch, applySwatchToNode, removeSwatch, updateSwatch } from './swatches';

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
      const id = doc.swatches?.[0]?.id!;
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
      const id = doc.swatches?.[0]?.id!;
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
      doc = addSwatch(doc, 'Red', red);
      const swatchId = doc.swatches?.[0]?.id!;
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
      doc = addSwatch(doc, 'Red', red);
      const result = applySwatchToNode(doc, 'nonexistent', doc.swatches?.[0]?.id!);
      expect(result).toBe(doc);
    });
  });
});

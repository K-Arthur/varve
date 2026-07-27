import type { Shape } from '@strata/engine';
import { createDocument, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import {
  invertSelectionCmd,
  selectAllChildrenCmd,
  selectAllWithSameBlendModeCmd,
  selectAllWithSameOpacityCmd,
  selectChildrenCmd,
  selectNextSiblingCmd,
  selectNone,
  selectParentCmd,
  selectPreviousSiblingCmd,
  selectSiblingsCmd,
} from '../selectionCommands';

function addShape(
  doc: ReturnType<typeof createDocument>,
  id: string,
  shape: Shape = { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
): ReturnType<typeof createDocument> {
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [id]: makeShapeNode(id, shape, { name: id }),
    },
    rootChildren: [...doc.rootChildren, id],
  };
}

function addShapeToParent(
  doc: ReturnType<typeof createDocument>,
  id: string,
  parentId: string,
  shape: Shape = { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
): ReturnType<typeof createDocument> {
  const parent = doc.nodes[parentId];
  if (!parent || (parent.kind !== 'frame' && parent.kind !== 'group')) return doc;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [id]: makeShapeNode(id, shape, { name: id }),
      [parentId]: {
        ...parent,
        children: [...(parent.children ?? []), id],
      },
    },
  };
}

describe('selectionCommands', () => {
  describe('selectNone', () => {
    it('returns empty selection', () => {
      const result = selectNone();
      expect(result.selection).toEqual([]);
      expect(result.primaryId).toBeNull();
    });
  });

  describe('invertSelectionCmd', () => {
    it('selects all visible unlocked nodes not in current selection', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');
      doc = addShape(doc, 'b');
      doc = addShape(doc, 'c');

      const { selection } = invertSelectionCmd(doc, ['a']);
      expect(selection).toContain('b');
      expect(selection).toContain('c');
      expect(selection).not.toContain('a');
    });

    it('excludes locked and hidden nodes', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');
      doc = addShape(doc, 'b');
      doc = addShape(doc, 'c');
      doc.nodes.b!.locked = true;
      doc.nodes.c!.visible = false;

      const { selection } = invertSelectionCmd(doc, ['a']);
      expect(selection).not.toContain('b');
      expect(selection).not.toContain('c');
    });
  });

  describe('selectParentCmd', () => {
    it('selects the parent of the primary node', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'child');
      doc = addShapeToParent(doc, 'child', 'parent' as never) as any;
      // Re-add parent properly
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          parent: {
            id: 'parent',
            kind: 'frame',
            name: 'Parent',
            tag: 'frame',
            transform: [1, 0, 0, 1, 0, 0],
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            rotation: 0,
            order: 'a0',
            w: 100,
            h: 100,
            children: ['child'],
            strokes: [],
            effects: [],
          } as any,
        },
        rootChildren: ['parent'],
      };

      const { selection, primaryId } = selectParentCmd(doc, 'child');
      expect(selection).toEqual(['parent']);
      expect(primaryId).toBe('parent');
    });

    it('returns empty when at root level', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');

      const { selection } = selectParentCmd(doc, 'a');
      expect(selection).toEqual([]);
    });
  });

  describe('selectChildrenCmd', () => {
    it('selects direct children of a container', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'child1');
      doc = addShape(doc, 'child2');
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          parent: {
            id: 'parent',
            kind: 'frame',
            name: 'Parent',
            tag: 'frame',
            transform: [1, 0, 0, 1, 0, 0],
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            rotation: 0,
            order: 'a0',
            w: 100,
            h: 100,
            children: ['child1', 'child2'],
            strokes: [],
            effects: [],
          } as any,
        },
        rootChildren: ['parent'],
      };

      const { selection } = selectChildrenCmd(doc, 'parent');
      expect(selection).toContain('child1');
      expect(selection).toContain('child2');
    });

    it('returns empty for non-container', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');

      const { selection } = selectChildrenCmd(doc, 'a');
      expect(selection).toEqual([]);
    });
  });

  describe('selectSiblingsCmd', () => {
    it('selects siblings excluding primary', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');
      doc = addShape(doc, 'b');
      doc = addShape(doc, 'c');
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          parent: {
            id: 'parent',
            kind: 'group',
            name: 'Parent',
            tag: 'group',
            transform: [1, 0, 0, 1, 0, 0],
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            rotation: 0,
            order: 'a0',
            children: ['a', 'b', 'c'],
            strokes: [],
            effects: [],
          } as any,
        },
        rootChildren: ['parent'],
      };

      const { selection } = selectSiblingsCmd(doc, 'a');
      expect(selection).toContain('b');
      expect(selection).toContain('c');
      expect(selection).not.toContain('a');
    });
  });

  describe('selectNextSiblingCmd', () => {
    it('selects next sibling in paint order', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');
      doc = addShape(doc, 'b');
      doc = addShape(doc, 'c');
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          parent: {
            id: 'parent',
            kind: 'group',
            name: 'Parent',
            tag: 'group',
            transform: [1, 0, 0, 1, 0, 0],
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            rotation: 0,
            order: 'a0',
            children: ['a', 'b', 'c'],
            strokes: [],
            effects: [],
          } as any,
        },
        rootChildren: ['parent'],
      };

      const { selection } = selectNextSiblingCmd(doc, 'a');
      expect(selection).toEqual(['b']);
    });

    it('wraps to first sibling from last', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');
      doc = addShape(doc, 'b');
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          parent: {
            id: 'parent',
            kind: 'group',
            name: 'Parent',
            tag: 'group',
            transform: [1, 0, 0, 1, 0, 0],
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            rotation: 0,
            order: 'a0',
            children: ['a', 'b'],
            strokes: [],
            effects: [],
          } as any,
        },
        rootChildren: ['parent'],
      };

      const { selection } = selectNextSiblingCmd(doc, 'b');
      expect(selection).toEqual(['a']);
    });
  });

  describe('selectPreviousSiblingCmd', () => {
    it('selects previous sibling in paint order', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');
      doc = addShape(doc, 'b');
      doc = addShape(doc, 'c');
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          parent: {
            id: 'parent',
            kind: 'group',
            name: 'Parent',
            tag: 'group',
            transform: [1, 0, 0, 1, 0, 0],
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            rotation: 0,
            order: 'a0',
            children: ['a', 'b', 'c'],
            strokes: [],
            effects: [],
          } as any,
        },
        rootChildren: ['parent'],
      };

      const { selection } = selectPreviousSiblingCmd(doc, 'b');
      expect(selection).toEqual(['a']);
    });
  });

  describe('selectAllChildrenCmd', () => {
    it('selects all descendants recursively', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'child');
      doc = addShape(doc, 'grandchild');
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          parent: {
            id: 'parent',
            kind: 'frame',
            name: 'Parent',
            tag: 'frame',
            transform: [1, 0, 0, 1, 0, 0],
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            rotation: 0,
            order: 'a0',
            w: 100,
            h: 100,
            children: ['child'],
            strokes: [],
            effects: [],
          } as any,
          child: {
            ...doc.nodes.child,
            kind: 'group',
            children: ['grandchild'],
          } as any,
        },
        rootChildren: ['parent'],
      };

      const { selection } = selectAllChildrenCmd(doc, 'parent');
      expect(selection).toContain('child');
      expect(selection).toContain('grandchild');
    });
  });

  describe('selectAllWithSameOpacityCmd', () => {
    it('selects nodes with matching opacity', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');
      doc = addShape(doc, 'b');
      doc = addShape(doc, 'c');
      doc.nodes.a!.opacity = 0.5;
      doc.nodes.b!.opacity = 0.5;
      doc.nodes.c!.opacity = 1;

      const { selection } = selectAllWithSameOpacityCmd(doc, 'a');
      expect(selection).toContain('a');
      expect(selection).toContain('b');
      expect(selection).not.toContain('c');
    });
  });

  describe('selectAllWithSameBlendModeCmd', () => {
    it('selects nodes with matching blend mode', () => {
      let doc = createDocument('test');
      doc = addShape(doc, 'a');
      doc = addShape(doc, 'b');
      doc = addShape(doc, 'c');
      doc.nodes.a!.blendMode = 'multiply';
      doc.nodes.b!.blendMode = 'multiply';
      doc.nodes.c!.blendMode = 'normal';

      const { selection } = selectAllWithSameBlendModeCmd(doc, 'a');
      expect(selection).toContain('a');
      expect(selection).toContain('b');
      expect(selection).not.toContain('c');
    });
  });
});

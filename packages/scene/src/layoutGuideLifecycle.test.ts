import { describe, expect, it } from 'vitest';
import { duplicateDesignCanvas } from './designCanvas';
import type { Document } from './document';
import { addChild, createDocument, makeFrameNode } from './document';
import { removeNode } from './document-nodes';
import { duplicatePage } from './document-pages';
import { makeGroupNode } from './document-utils';
import { createDefaultLayoutGrid } from './gridTypes';
import { cloneLayoutGuidesForIdMap, pruneOrphanedLayoutGuides } from './layoutGuideLifecycle';

function guide(frameId: string, id = 'guide'): ReturnType<typeof createDefaultLayoutGrid> {
  return {
    ...createDefaultLayoutGrid(),
    id,
    frameId,
    name: 'Editorial columns',
    margins: { top: 12, right: 16, bottom: 12, left: 16 },
  };
}

describe('layout guide lifecycle', () => {
  it('remaps keyed metadata for a cloned subtree', () => {
    const doc = createDocument('clone') as Document;
    const source = makeFrameNode('frame-source', { w: 320, h: 240 });
    const withFrame = {
      ...doc,
      nodes: { ...doc.nodes, [source.id]: source },
      rootChildren: [source.id],
    };
    const cloned = cloneLayoutGuidesForIdMap(
      { ...withFrame, gridSettings: { layoutGrids: { [source.id]: [guide(source.id)] } } },
      new Map([['frame-source', 'frame-copy']]),
    );

    expect(cloned.gridSettings?.layoutGrids?.['frame-source']).toHaveLength(1);
    expect(cloned.gridSettings?.layoutGrids?.['frame-copy']?.[0]).toMatchObject({
      frameId: 'frame-copy',
      id: 'frame-copy:layout:1',
      name: 'Editorial columns copy',
    });
    expect(cloned.gridSettings?.layoutGrids?.['frame-copy']?.[0]?.margins).toEqual({
      top: 12,
      right: 16,
      bottom: 12,
      left: 16,
    });
  });

  it('prunes entries for deleted frame descendants', () => {
    const frame = makeFrameNode('frame-delete');
    const doc = {
      ...(createDocument('delete') as Document),
      rootChildren: [frame.id],
      nodes: { ...((createDocument('delete') as Document).nodes ?? {}), [frame.id]: frame },
      gridSettings: { layoutGrids: { [frame.id]: [guide(frame.id)] } },
    } as Document;
    const next = removeNode(doc, frame.id);
    expect(next.nodes[frame.id]).toBeUndefined();
    expect(next.gridSettings?.layoutGrids).toBeUndefined();
    expect(pruneOrphanedLayoutGuides(doc).gridSettings?.layoutGrids).toHaveProperty(frame.id);
  });

  it('carries nested frame layouts through page duplication', () => {
    let doc = createDocument('pages') as Document;
    const page = {
      id: 'page-source',
      name: 'Source',
      order: 'a0',
      width: 800,
      height: 600,
      backgrounds: [],
      contentRoot: 'page-root',
    };
    const root = makeGroupNode(page.contentRoot, { name: 'Source content' });
    doc = {
      ...doc,
      pages: [page],
      rootChildren: [root.id],
      nodes: { ...doc.nodes, [root.id]: root },
    };
    const frame = makeFrameNode('page-frame', { w: 300, h: 200 });
    doc = addChild(doc, root.id, frame);
    doc = {
      ...doc,
      gridSettings: { layoutGrids: { [frame.id]: [guide(frame.id)] } },
    };

    const duplicated = duplicatePage(doc, page.id);
    const copiedFrame = Object.values(duplicated.nodes).find(
      (node) => node.kind === 'frame' && node.id !== frame.id,
    );
    expect(copiedFrame).toBeDefined();
    expect(duplicated.gridSettings?.layoutGrids?.[copiedFrame!.id]?.[0]).toMatchObject({
      frameId: copiedFrame!.id,
      name: 'Editorial columns copy',
    });
  });

  it('carries layouts through design-canvas duplication', () => {
    const root = makeGroupNode('canvas-root', { name: 'Canvas content' });
    const frame = makeFrameNode('canvas-frame', { w: 400, h: 300 });
    const doc = {
      ...(createDocument('canvas') as Document),
      nodes: {
        ...((createDocument('canvas') as Document).nodes ?? {}),
        [root.id]: root,
        [frame.id]: frame,
      },
      rootChildren: [root.id],
      designCanvases: [{ id: 'canvas-source', name: 'Canvas', order: 'a0', contentRoot: root.id }],
      gridSettings: { layoutGrids: { [frame.id]: [guide(frame.id)] } },
    } as Document;
    const duplicated = duplicateDesignCanvas(addChild(doc, root.id, frame), 'canvas-source');
    const copiedRoot = duplicated.designCanvases?.find((canvas) => canvas.id !== 'canvas-source');
    expect(copiedRoot).toBeDefined();
    const copiedFrame = Object.values(duplicated.nodes).find(
      (node) => node.kind === 'frame' && node.id !== frame.id,
    );
    expect(copiedFrame).toBeDefined();
    expect(duplicated.gridSettings?.layoutGrids?.[copiedFrame!.id]?.[0]).toMatchObject({
      frameId: copiedFrame!.id,
    });
  });
});

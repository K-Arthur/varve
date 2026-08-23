// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import type { Adjustment } from '@varve/engine';
import {
  addChild,
  addNode,
  createDocument,
  DocumentCodec,
  makeAdjustment,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { EditorProvider, useEditor } from '../context';

function firstSelectedId(ctx: EditorContextValue): string {
  const id = ctx.state.selection[0];
  if (!id) throw new Error('Expected a selected node');
  return id;
}

function getNode(ctx: EditorContextValue, id: string) {
  const n = ctx.state.document.nodes[id];
  if (!n) throw new Error('Expected node to exist');
  return n;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('adjustment layer', () => {
  function setup() {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    return { getCtx: () => ctx as NonNullable<typeof ctx> };
  }

  it('createAdjustmentLayer creates a node in the document and selects it', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    getCtx().createAdjustmentLayer();

    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx.state.selection.length).toBe(1);
    });

    const nodeId = firstSelectedId(getCtx());
    const node = getNode(getCtx(), nodeId);
    expect(node.kind).toBe('adjustment');
    expect(node.name).toMatch(/Adjustment/);
  });

  it('createAdjustmentLayer with initial adjustments', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    const adj = makeAdjustment('test-adj', 'brightness', { value: 20 });
    getCtx().createAdjustmentLayer([adj]);

    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx.state.selection.length).toBe(1);
    });

    const nodeId = firstSelectedId(getCtx());
    const node = getNode(getCtx(), nodeId);
    expect(node.kind).toBe('adjustment');
    if (node.kind === 'adjustment') {
      expect(node.adjustments?.length).toBe(1);
      expect(node.adjustments?.[0]?.kind).toBe('brightness');
      expect(node.adjustments?.[0]).toMatchObject({ value: 20 });
    }
  });

  it('places a frame adjustment inside the frame with descendant scope', async () => {
    const { getCtx } = setup();
    let doc = createDocument('Frame adjustment', true);
    const frame = makeFrameNode('frame', { name: 'Artwork', w: 200, h: 160 });
    const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 80, h: 80 });
    doc = addNode(doc, frame);
    doc = addChild(doc, frame.id, child);
    getCtx().loadDocument(DocumentCodec.encode(doc));
    await waitFor(() => expect(getCtx().state.document.nodes.frame).toBeDefined());

    getCtx().setSelection(frame.id);
    await waitFor(() => expect(getCtx().state.selection).toEqual([frame.id]));
    getCtx().createAdjustmentLayer();

    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));
    const adjustment = getNode(getCtx(), firstSelectedId(getCtx()));
    expect(adjustment.kind).toBe('adjustment');
    expect(adjustment.kind === 'adjustment' && adjustment.scope).toEqual({
      mode: 'container-descendant',
      containerId: frame.id,
      includeNested: true,
    });
    expect(getCtx().state.document.nodes[frame.id]?.kind).toBe('frame');
    const frameAfter = getCtx().state.document.nodes[frame.id];
    expect(frameAfter?.kind === 'frame' && frameAfter.children.at(-1)).toBe(adjustment.id);
  });

  it('places a leaf adjustment beside the selected object with image-local scope', async () => {
    const { getCtx } = setup();
    let doc = createDocument('Leaf adjustment', true);
    const frame = makeFrameNode('frame', { name: 'Artwork', w: 200, h: 160 });
    const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 80, h: 80 });
    doc = addNode(doc, frame);
    doc = addChild(doc, frame.id, child);
    getCtx().loadDocument(DocumentCodec.encode(doc));
    await waitFor(() => expect(getCtx().state.document.nodes.child).toBeDefined());

    getCtx().setSelection(child.id);
    await waitFor(() => expect(getCtx().state.selection).toEqual([child.id]));
    getCtx().createAdjustmentLayer();

    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));
    const adjustment = getNode(getCtx(), firstSelectedId(getCtx()));
    expect(adjustment.kind).toBe('adjustment');
    expect(adjustment.kind === 'adjustment' && adjustment.scope).toEqual({
      mode: 'image-local',
      targetNodeId: child.id,
    });
    const frameAfter = getCtx().state.document.nodes[frame.id];
    expect(frameAfter?.kind === 'frame' && frameAfter.children).toEqual([child.id, adjustment.id]);
  });

  it('creates LUT adjustment layers at visible layer opacity', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    getCtx().addLutAdjustment(makeAdjustment('lut-1', 'lut'));

    await waitFor(() => {
      expect(getCtx().state.selection.length).toBe(1);
    });
    const node = getNode(getCtx(), firstSelectedId(getCtx()));
    expect(node.kind).toBe('adjustment');
    expect(node.opacity).toBe(1);
  });

  it('addAdjustmentToLayer appends an adjustment', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    getCtx().createAdjustmentLayer();
    await waitFor(() => {
      expect(getCtx().state.selection.length).toBe(1);
    });

    const nodeId = firstSelectedId(getCtx());

    const adj = makeAdjustment('adj-1', 'contrast', { value: 30 });
    getCtx().addAdjustmentToLayer(nodeId, adj);

    await waitFor(() => {
      const n = getNode(getCtx(), nodeId);
      expect(n.kind).toBe('adjustment');
      if (n.kind === 'adjustment') {
        expect(n.adjustments?.length).toBe(1);
        expect(n.adjustments?.[0]?.kind).toBe('contrast');
      }
    });
  });

  it('removeAdjustmentFromLayer removes by id', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    const adj = makeAdjustment('adj-remove', 'brightness');
    getCtx().createAdjustmentLayer([adj]);
    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx.state.selection.length).toBe(1);
    });

    const nodeId = firstSelectedId(getCtx());

    getCtx().removeAdjustmentFromLayer(nodeId, 'adj-remove');

    await waitFor(() => {
      const n = getNode(getCtx(), nodeId);
      expect(n.kind).toBe('adjustment');
      if (n.kind === 'adjustment') {
        expect(n.adjustments?.length).toBe(0);
      }
    });
  });

  it('updateAdjustmentInLayer patches properties', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    const adj = makeAdjustment('adj-upd', 'brightness', { value: 10 });
    getCtx().createAdjustmentLayer([adj]);
    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx.state.selection.length).toBe(1);
    });

    const nodeId = firstSelectedId(getCtx());

    getCtx().updateAdjustmentInLayer(nodeId, 'adj-upd', { visible: false } as Partial<Adjustment>);

    await waitFor(() => {
      const n = getNode(getCtx(), nodeId);
      expect(n.kind).toBe('adjustment');
      if (n.kind === 'adjustment') {
        const updated = n.adjustments?.find((a: { id: string }) => a.id === 'adj-upd');
        expect(updated).toBeDefined();
        expect(updated?.visible).toBe(false);
      }
    });
  });

  it('reorderAdjustmentInLayer changes order', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    const adj1 = makeAdjustment('adj-a', 'brightness');
    const adj2 = makeAdjustment('adj-b', 'contrast');
    getCtx().createAdjustmentLayer([adj1, adj2]);
    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx.state.selection.length).toBe(1);
    });

    const nodeId = firstSelectedId(getCtx());

    getCtx().reorderAdjustmentInLayer(nodeId, 'adj-b', 0);

    await waitFor(() => {
      const n = getNode(getCtx(), nodeId);
      expect(n.kind).toBe('adjustment');
      if (n.kind === 'adjustment') {
        expect(n.adjustments?.[0]?.id).toBe('adj-b');
        expect(n.adjustments?.[1]?.id).toBe('adj-a');
      }
    });
  });

  it('setAdjustmentLayerOpacity updates node opacity', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    getCtx().createAdjustmentLayer();
    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx.state.selection.length).toBe(1);
    });

    const nodeId = firstSelectedId(getCtx());

    getCtx().setAdjustmentLayerOpacity(nodeId, 0.5);

    await waitFor(() => {
      expect(getCtx().state.document.nodes[nodeId]?.opacity).toBe(0.5);
    });
  });

  it('setAdjustmentLayerBlendMode updates node blend mode', async () => {
    const { getCtx } = setup();
    await waitFor(() => expect(getCtx()).toBeDefined());

    getCtx().createAdjustmentLayer();
    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx.state.selection.length).toBe(1);
    });

    const nodeId = firstSelectedId(getCtx());

    getCtx().setAdjustmentLayerBlendMode(nodeId, 'multiply');

    await waitFor(() => {
      expect(getCtx().state.document.nodes[nodeId]?.blendMode).toBe('multiply');
    });
  });
});

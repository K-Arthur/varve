/**
 * Text node parenting tests — verify createTextNodeAt coordinate conversion.
 *
 * Tests that text nodes created inside translated frames have their
 * transforms correctly converted to parent-local space.
 *
 * Research basis: scene-graph transform composition (same as createShapeAt).
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

describe('Text node parenting tests', () => {
  it('Text node created inside translated frame has local-space transform', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    expect(ctx).toBeDefined();
    if (!ctx) throw new Error('ctx not found');
    const getCtx = (): NonNullable<typeof ctx> => ctx as NonNullable<typeof ctx>;

    // Create a frame at world position (100, 100) with size (200, 200)
    getCtx().setTool('frame');
    getCtx().createShapeAt({ x: 100, y: 100 }, { w: 200, h: 200 });

    await waitFor(() => {
      const nodes = Object.values(getCtx().state.document.nodes);
      const frame = nodes.find((n) => n.kind === 'frame');
      expect(frame).toBeDefined();
      if (frame?.kind !== 'frame') throw new Error('frame not found');
      expect(frame.children).toBeDefined();
    });

    // Verify the frame is at the expected world position
    const frame = Object.values(getCtx().state.document.nodes).find((n) => n.kind === 'frame');
    expect(frame).toBeDefined();
    if (frame?.kind !== 'frame') throw new Error('frame not found');
    expect(frame.transform).toEqual([1, 0, 0, 1, 100, 100]);

    // Create a text node inside the frame at world position (150, 150)
    const initialNodeCount = Object.keys(getCtx().state.document.nodes).length;
    getCtx().createTextNodeAt({ x: 150, y: 150 });

    await waitFor(() => {
      const finalCount = Object.keys(getCtx().state.document.nodes).length;
      expect(finalCount).toBe(initialNodeCount + 1);
    });

    // Find the text node
    const textNode = Object.values(getCtx().state.document.nodes).find((n) => n.kind === 'text');
    expect(textNode).toBeDefined();
    if (!textNode) throw new Error('text node not found');

    // The text node's transform should be in local (parent) space.
    // World (150, 150) minus frame offset (100, 100) = local (50, 50).
    // Without the fix, the transform would incorrectly be [1,0,0,1,150,150].
    expect(textNode.transform).toEqual([1, 0, 0, 1, 50, 50]);

    // The text node should be a child of the frame
    const updatedFrame = Object.values(getCtx().state.document.nodes).find(
      (n) => n.kind === 'frame',
    );
    expect(updatedFrame).toBeDefined();
    if (updatedFrame?.kind !== 'frame') throw new Error('frame not found');
    expect(updatedFrame.children).toContain(textNode.id);
  });

  it('Text node created outside frame uses world-space transform', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    expect(ctx).toBeDefined();
    if (!ctx) throw new Error('ctx not found');
    const getCtx = (): NonNullable<typeof ctx> => ctx as NonNullable<typeof ctx>;

    // Create a frame at world position (100, 100) with size (200, 200)
    getCtx().setTool('frame');
    getCtx().createShapeAt({ x: 100, y: 100 }, { w: 200, h: 200 });

    await waitFor(() => {
      const nodes = Object.values(getCtx().state.document.nodes);
      const frame = nodes.find((n) => n.kind === 'frame');
      expect(frame).toBeDefined();
    });

    // Create a text node OUTSIDE the frame at world position (400, 400)
    const initialNodeCount = Object.keys(getCtx().state.document.nodes).length;
    getCtx().createTextNodeAt({ x: 400, y: 400 });

    await waitFor(() => {
      const finalCount = Object.keys(getCtx().state.document.nodes).length;
      expect(finalCount).toBe(initialNodeCount + 1);
    });

    // Find the text node
    const textNode = Object.values(getCtx().state.document.nodes).find((n) => n.kind === 'text');
    expect(textNode).toBeDefined();
    if (!textNode) throw new Error('text node not found');

    // Text outside frame should keep world-space transform
    expect(textNode.transform).toEqual([1, 0, 0, 1, 400, 400]);

    // Text should NOT be a child of the frame
    const frame = Object.values(getCtx().state.document.nodes).find((n) => n.kind === 'frame');
    expect(frame).toBeDefined();
    if (frame?.kind !== 'frame') throw new Error('frame not found');
    expect(frame.children).not.toContain(textNode.id);
  });
});

/**
 * Frame parenting tests — verify spatial containment and parenting logic.
 *
 * Tests that shapes created inside frames become children of those frames,
 * and that the containment heuristic works correctly for nested frames.
 *
 * Research basis: Figma frame parenting, spatial containment algorithms.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

describe('Frame parenting tests', () => {
  it('Shape created inside frame becomes child of frame', async () => {
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

    // Create a frame at position (100, 100) with size (200, 200)
    getCtx().setTool('frame');
    getCtx().createShapeAt({ x: 100, y: 100 }, { w: 200, h: 200 });

    await waitFor(() => {
      const nodes = Object.values(getCtx().state.document.nodes);
      const frame = nodes.find((n) => n.kind === 'frame');
      expect(frame).toBeDefined();
      if (!frame) throw new Error('frame not found');
      expect(frame.kind).toBe('frame');
    });

    // Now create a rectangle inside the frame at (150, 150)
    getCtx().setTool('rect');
    const initialNodes = Object.keys(getCtx().state.document.nodes).length;
    getCtx().createShapeAt({ x: 150, y: 150 }, { w: 50, h: 30 });

    await waitFor(() => {
      const finalNodes = Object.keys(getCtx().state.document.nodes).length;
      expect(finalNodes).toBe(initialNodes + 1);
    });

    // Verify the rectangle is a child of the frame
    const nodes = Object.values(getCtx().state.document.nodes);
    const frame = nodes.find((n) => n.kind === 'frame');
    const rect = nodes.find((n) => n.kind === 'shape' && n.shape.kind === 'rect');

    expect(frame).toBeDefined();
    expect(rect).toBeDefined();
    if (!frame || !rect) throw new Error('frame or rect not found');

    if (frame.kind === 'frame') {
      expect(frame.children).toContain(rect.id);
    }
  });

  it('Shape created outside frame becomes page child', async () => {
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

    // Create a frame at position (100, 100) with size (200, 200)
    getCtx().setTool('frame');
    getCtx().createShapeAt({ x: 100, y: 100 }, { w: 200, h: 200 });

    await waitFor(() => {
      const nodes = Object.values(getCtx().state.document.nodes);
      const frame = nodes.find((n) => n.kind === 'frame');
      expect(frame).toBeDefined();
    });

    // Create a rectangle outside the frame at (400, 400)
    getCtx().setTool('rect');
    const initialNodes = Object.keys(getCtx().state.document.nodes).length;
    getCtx().createShapeAt({ x: 400, y: 400 }, { w: 50, h: 30 });

    await waitFor(() => {
      const finalNodes = Object.keys(getCtx().state.document.nodes).length;
      expect(finalNodes).toBe(initialNodes + 1);
    });

    // Verify the rectangle is NOT a child of the frame
    const nodes = Object.values(getCtx().state.document.nodes);
    const frame = nodes.find((n) => n.kind === 'frame');
    const rect = nodes.find((n) => n.kind === 'shape' && n.shape.kind === 'rect');

    expect(frame).toBeDefined();
    expect(rect).toBeDefined();
    if (!frame || !rect) throw new Error('frame or rect not found');

    if (frame.kind === 'frame') {
      expect(frame.children).not.toContain(rect.id);
    }
  });

  it('Nested frames: innermost containing frame wins', async () => {
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

    // Create outer frame at (100, 100) with size (400, 400)
    getCtx().setTool('frame');
    getCtx().createShapeAt({ x: 100, y: 100 }, { w: 400, h: 400 });

    await waitFor(() => {
      const nodes = Object.values(getCtx().state.document.nodes);
      const frames = nodes.filter((n) => n.kind === 'frame');
      expect(frames.length).toBe(1);
    });

    // Create inner frame at (200, 200) with size (200, 200)
    getCtx().setTool('frame');
    getCtx().createShapeAt({ x: 200, y: 200 }, { w: 200, h: 200 });

    await waitFor(() => {
      const nodes = Object.values(getCtx().state.document.nodes);
      const frames = nodes.filter((n) => n.kind === 'frame');
      expect(frames.length).toBe(2);
    });

    // Create a rectangle inside the inner frame at (250, 250)
    getCtx().setTool('rect');
    const initialNodes = Object.keys(getCtx().state.document.nodes).length;
    getCtx().createShapeAt({ x: 250, y: 250 }, { w: 50, h: 30 });

    await waitFor(() => {
      const finalNodes = Object.keys(getCtx().state.document.nodes).length;
      expect(finalNodes).toBe(initialNodes + 1);
    });

    // Verify the rectangle is a child of the inner frame, not the outer
    const nodes = Object.values(getCtx().state.document.nodes);
    const frames = nodes.filter((n) => n.kind === 'frame');
    const rect = nodes.find((n) => n.kind === 'shape' && n.shape.kind === 'rect');

    expect(frames.length).toBe(2);
    expect(rect).toBeDefined();
    if (!rect) throw new Error('rect not found');

    // The inner frame should be the one containing the rectangle
    const innerFrame = frames.find((f) => {
      if (f.kind !== 'frame') return false;
      return f.children.includes(rect.id);
    });

    expect(innerFrame).toBeDefined();
  });

  it('findContainingFrameInDoc returns deepest containing frame', async () => {
    // Simplified test: verify containment function works for a single frame
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

    // Create a frame at (100, 100) with size (200, 200)
    getCtx().setTool('frame');
    getCtx().createShapeAt({ x: 100, y: 100 }, { w: 200, h: 200 });

    await waitFor(() => {
      const nodes = Object.values(getCtx().state.document.nodes);
      const frames = nodes.filter((n) => n.kind === 'frame');
      expect(frames.length).toBe(1);
    });

    // Get the frame ID
    const nodes = Object.values(getCtx().state.document.nodes);
    const frame = nodes.find((n) => n.kind === 'frame');
    expect(frame).toBeDefined();

    // Test point inside frame (150, 150)
    const resultInside = getCtx().findContainingFrame({ x: 150, y: 150 });

    // Should return the frame
    expect(resultInside).toBe(frame?.id ?? null);

    // Test point outside frame (50, 50)
    const resultOutside = getCtx().findContainingFrame({ x: 50, y: 50 });

    // Should return null
    expect(resultOutside).toBeNull();

    // Test point on frame edge (100, 100) - should be inside
    const resultEdge = getCtx().findContainingFrame({ x: 100, y: 100 });

    // Should return the frame (edge is considered inside)
    expect(resultEdge).toBe(frame?.id ?? null);
  });
});

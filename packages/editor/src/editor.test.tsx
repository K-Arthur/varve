import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, type ToolId, useEditor } from './context';
import { Shell } from './Shell';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Shell', () => {
  it('renders all key regions', () => {
    render(<Shell />);
    // Menubar present
    expect(screen.getByRole('menubar')).toBeTruthy();
    // Toolbar present
    expect(screen.getByRole('toolbar')).toBeTruthy();
    // Canvas region present
    expect(screen.getByRole('region', { name: /canvas/i })).toBeTruthy();
    // Layers tree present
    expect(screen.getByRole('tree')).toBeTruthy();
    // Inspector region present
    expect(screen.getByRole('region', { name: /inspector/i })).toBeTruthy();
  });

  it('renders without canvas environment errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<Shell />);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('EditorContext', () => {
  it('provides default state', () => {
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
    expect(ctx?.state.tool).toBe('select');
    expect(ctx?.state.zoom).toBe(1);
    expect(ctx?.state.selection).toEqual([]);
  });

  it('updates tool via setTool', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button type="button" onClick={() => ctx?.setTool('rect')}>
          set rect
        </button>
      );
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    screen.getByText('set rect').click();
    await waitFor(() => expect(ctx?.state.tool).toBe('rect'));
  });

  it('creates a named line shape from a dragged line tool gesture', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => {
            ctx?.setTool('line' as ToolId);
            ctx?.createShapeAt({ x: 10, y: 20 }, { w: 80, h: 30 });
          }}
        >
          draw line
        </button>
      );
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    screen.getByText('draw line').click();

    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    const id = ctx?.state.selection[0];
    const node = id ? ctx?.state.document.nodes[id] : undefined;
    expect(node?.name).toBe('Line 1');
    expect(node?.kind).toBe('shape');
    expect(node?.kind === 'shape' ? node.shape : undefined).toEqual({
      kind: 'line',
      from: [0, 0],
      to: [80, 30],
      tolerance: 3,
    });
  });

  it('creates a named polygon shape from polygon tool', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => {
            ctx?.setTool('polygon' as ToolId);
            ctx?.createShapeAt({ x: 50, y: 50 }, { w: 100, h: 80 });
          }}
        >
          draw polygon
        </button>
      );
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    screen.getByText('draw polygon').click();

    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    const id = ctx?.state.selection[0];
    const node = id ? ctx?.state.document.nodes[id] : undefined;
    expect(node?.name).toBe('Polygon 1');
    expect(node?.kind).toBe('shape');
    expect(node?.kind === 'shape' ? node.shape.kind : undefined).toBe('polygon');
  });

  it('creates a named arrow shape from arrow tool', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => {
            ctx?.setTool('arrow' as ToolId);
            ctx?.createShapeAt({ x: 10, y: 20 }, { w: 80, h: 30 });
          }}
        >
          draw arrow
        </button>
      );
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    screen.getByText('draw arrow').click();

    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    const id = ctx?.state.selection[0];
    const node = id ? ctx?.state.document.nodes[id] : undefined;
    expect(node?.name).toBe('Arrow 1');
    expect(node?.kind).toBe('shape');
    expect(node?.kind === 'shape' ? node.shape.kind : undefined).toBe('arrow');
  });

  it('creates a named star shape from star tool', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => {
            ctx?.setTool('star' as ToolId);
            ctx?.createShapeAt({ x: 50, y: 50 }, { w: 100, h: 80 });
          }}
        >
          draw star
        </button>
      );
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    screen.getByText('draw star').click();

    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    const id = ctx?.state.selection[0];
    const node = id ? ctx?.state.document.nodes[id] : undefined;
    expect(node?.name).toBe('Star 1');
    expect(node?.kind).toBe('shape');
    expect(node?.kind === 'shape' ? node.shape.kind : undefined).toBe('star');
  });

  it('hitTestNode returns nested child before parent frame', async () => {
    const { createDocument, makeFrameNode, makeShapeNode, addNode, addChild } = await import(
      '@strata/scene'
    );

    // Create a doc with: root → frame → rectChild
    let doc = createDocument('hit-test');
    const frame = makeFrameNode('f1', {
      name: 'Frame',
      w: 200,
      h: 200,
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, frame);
    const rect = makeShapeNode(
      'r1',
      { kind: 'rect', x: 50, y: 50, w: 100, h: 100 },
      { name: 'Rect' },
    );
    doc = addChild(doc, 'f1', rect);

    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <Test />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });

    // Click at center of rect child (world-space 100,100)
    const hit = ctx!.hitTestNode({ x: 100, y: 100 });
    expect(hit).not.toBeNull();
    // Should return the rect child, not the frame parent
    expect(hit!.nodeId).toBe('r1');
    expect(hit!.node.kind).toBe('shape');
  });

  it('hitTestNode returns parent frame when clicking frame area without children', async () => {
    const { createDocument, makeFrameNode, makeShapeNode, addNode, addChild } = await import(
      '@strata/scene'
    );

    let doc = createDocument('hit-test');
    const frame = makeFrameNode('f1', { name: 'Frame', w: 200, h: 200 });
    doc = addNode(doc, frame);
    const rect = makeShapeNode(
      'r1',
      { kind: 'rect', x: 150, y: 150, w: 30, h: 30 },
      { name: 'Rect' },
    );
    doc = addChild(doc, 'f1', rect);

    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <Test />
      </EditorProvider>,
    );

    await waitFor(() => expect(ctx).toBeDefined());

    // Click at a point inside the frame but outside the child rect
    const hit = ctx!.hitTestNode({ x: 10, y: 10 });
    expect(hit).not.toBeNull();
    expect(hit!.nodeId).toBe('f1');
  });
});

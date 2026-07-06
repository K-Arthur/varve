import type { SceneNode } from '@strata/scene';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
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

  it('renders without canvas environment errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('menubar')).toBeTruthy());

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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
    const hit = ctx?.hitTestNode({ x: 100, y: 100 });
    expect(hit).not.toBeNull();
    // Should return the rect child, not the frame parent
    expect(hit?.nodeId).toBe('r1');
    expect(hit?.node.kind).toBe('shape');
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
    const hit = ctx?.hitTestNode({ x: 10, y: 10 });
    expect(hit).not.toBeNull();
    expect(hit?.nodeId).toBe('f1');
  });

  describe('duplicateSelected', () => {
    it('deep-clones container nodes with new IDs and offset transforms', async () => {
      const { createDocument, makeFrameNode, makeShapeNode, makeGroupNode, addNode, addChild } =
        await import('@strata/scene');

      // Build: root -> frame(f1) -> rect(r1) and group(g2) -> rect(r2)
      // This tests one level deep (r1) and two levels deep (r2 inside g2 inside f1)
      let doc = createDocument('dup-test');
      const frame = makeFrameNode('f1', {
        name: 'Frame',
        w: 200,
        h: 200,
        transform: [1, 0, 0, 1, 100, 100],
      });
      doc = addNode(doc, frame);

      const r1 = makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: 'Rect1', transform: [1, 0, 0, 1, 10, 10] },
      );
      doc = addChild(doc, 'f1', r1);

      const g2 = makeGroupNode('g2', {
        name: 'InnerGroup',
        transform: [1, 0, 0, 1, 0, 0],
      });
      doc = addChild(doc, 'f1', g2);

      const r2 = makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
        { name: 'Rect2', transform: [1, 0, 0, 1, 5, 5] },
      );
      doc = addChild(doc, 'g2', r2);

      const origChildIds = [...(doc.nodes.f1! as unknown as { children: string[] }).children];

      let ctx: ReturnType<typeof useEditor> | undefined;
      let callCount = 0;
      function Test() {
        ctx = useEditor();
        const clicked = React.useRef(false);
        React.useEffect(() => {
          if (!clicked.current) {
            clicked.current = true;
            ctx?.setSelection('f1');
          }
        }, []);
        return (
          <button
            type="button"
            onClick={() => {
              callCount++;
              ctx?.duplicateSelected();
            }}
          >
            duplicate
          </button>
        );
      }
      render(
        <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
          <Test />
        </EditorProvider>,
      );

      await waitFor(() => {
        expect(ctx).toBeDefined();
        expect(ctx?.state.selection).toEqual(['f1']);
      });

      screen.getByText('duplicate').click();

      await waitFor(() => {
        expect(callCount).toBeGreaterThanOrEqual(1);
        expect(ctx?.state.selection).toHaveLength(1);
        expect(ctx?.state.selection[0]).not.toBe('f1');
      });

      const newId = ctx?.state.selection[0]!;

      const newFrame = ctx?.state.document.nodes[newId] as SceneNode & { children: string[] };
      expect(newFrame).toBeDefined();
      expect(newFrame.name).toBe('Frame copy');

      // The children array must contain new (cloned) IDs, not the old ones
      expect(newFrame.children).toHaveLength(origChildIds.length);
      for (const childId of newFrame.children) {
        expect(origChildIds).not.toContain(childId);
      }

      // Cloned children must exist as nodes in the document
      for (const childId of newFrame.children) {
        expect(ctx?.state.document.nodes[childId]).toBeDefined();
      }

      // The cloned frame transform must be offset by +20,+20
      expect(newFrame.transform[4]).toBe(120);
      expect(newFrame.transform[5]).toBe(120);

      // Direct child rect must have offset transform (+20,+20 from original)
      const newChild1 = ctx?.state.document.nodes[newFrame.children[0]!] as SceneNode;
      expect(newChild1.transform[4]).toBe(30); // was 10, now 30
      expect(newChild1.transform[5]).toBe(30); // was 10, now 30
      expect(newChild1.name).toBe('Rect1 copy');

      // The cloned group (second child) must also be offset and contain cloned children
      const newGroup = ctx?.state.document.nodes[newFrame.children[1]!] as SceneNode & {
        children: string[];
      };
      expect(newGroup).toBeDefined();
      expect(newGroup.name).toBe('InnerGroup copy');
      expect(newGroup.transform[4]).toBe(20); // was 0, now 20
      expect(newGroup.transform[5]).toBe(20); // was 0, now 20

      // The group's child must also be a clone (deep-cloned grandchild)
      expect(newGroup.children).toHaveLength(1);
      expect(newGroup.children[0]).not.toBe('r2');
      const newChild2 = ctx?.state.document.nodes[newGroup.children[0]!] as SceneNode;
      expect(newChild2).toBeDefined();
      expect(newChild2.name).toBe('Rect2 copy');
      expect(newChild2.transform[4]).toBe(25); // was 5, now 25
      expect(newChild2.transform[5]).toBe(25); // was 5, now 25

      // Original nodes must still exist unchanged
      expect(ctx?.state.document.nodes.f1).toBeDefined();
      expect(ctx?.state.document.nodes.r1).toBeDefined();
      expect(ctx?.state.document.nodes.g2).toBeDefined();
      expect(ctx?.state.document.nodes.r2).toBeDefined();
      const origFrame = ctx?.state.document.nodes.f1 as SceneNode & { children: string[] };
      expect(origFrame.children).toEqual(origChildIds);
    });

    it('deep-clones a GroupNode container', async () => {
      const { createDocument, makeGroupNode, makeShapeNode, addNode, addChild } = await import(
        '@strata/scene'
      );

      let doc = createDocument('dup-group-test');
      const group = makeGroupNode('g1', {
        name: 'Group',
        transform: [1, 0, 0, 1, 50, 50],
      });
      doc = addNode(doc, group);

      const s1 = makeShapeNode(
        's1',
        { kind: 'ellipse', cx: 20, cy: 20, rx: 20, ry: 20 },
        { name: 'Ellipse', transform: [1, 0, 0, 1, 0, 0] },
      );
      doc = addChild(doc, 'g1', s1);

      let ctx: ReturnType<typeof useEditor> | undefined;
      let _callCount = 0;
      function Test() {
        ctx = useEditor();
        const clicked = React.useRef(false);
        React.useEffect(() => {
          if (!clicked.current) {
            clicked.current = true;
            ctx?.setSelection('g1');
          }
        }, []);
        return (
          <button
            type="button"
            onClick={() => {
              _callCount++;
              ctx?.duplicateSelected();
            }}
          >
            dup group
          </button>
        );
      }
      render(
        <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
          <Test />
        </EditorProvider>,
      );

      await waitFor(() => {
        expect(ctx).toBeDefined();
        expect(ctx?.state.selection).toEqual(['g1']);
      });

      screen.getByText('dup group').click();

      await waitFor(() => {
        expect(ctx?.state.selection).toHaveLength(1);
        expect(ctx?.state.selection[0]).not.toBe('g1');
      });

      const newId = ctx?.state.selection[0]!;
      const newGroup = ctx?.state.document.nodes[newId] as SceneNode & { children: string[] };
      expect(newGroup.name).toBe('Group copy');
      expect(newGroup.children).toHaveLength(1);
      expect(newGroup.children[0]).not.toBe('s1');
      expect(ctx?.state.document.nodes[newGroup.children[0]!]).toBeDefined();
      expect(newGroup.transform[4]).toBe(70);
      expect(newGroup.transform[5]).toBe(70);
    });
  });
});

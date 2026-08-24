// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { Document, SceneNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasAccessibilityTree } from './CanvasAccessibilityTree';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeNode(overrides: Partial<SceneNode> & { id: string }): SceneNode {
  return {
    kind: 'shape',
    name: 'Rectangle 1',
    fill: null,
    fills: [],
    strokes: [],
    effects: [],
    transform: [1, 0, 0, 1, 0, 0] as const,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    ...overrides,
  } as SceneNode;
}

function makeDoc(nodes: SceneNode[]): Document {
  const nodeMap: Record<string, SceneNode> = {};
  const rootChildren: string[] = [];
  for (const n of nodes) {
    nodeMap[n.id] = n;
    rootChildren.push(n.id);
  }
  return {
    id: 'doc-1',
    name: 'Test Doc',
    nodes: nodeMap,
    rootChildren,
    formatVersion: '1.2',
  } as unknown as Document;
}

describe('CanvasAccessibilityTree', () => {
  it('renders visible nodes as hidden list items', () => {
    const doc = makeDoc([makeNode({ id: 'n1', name: 'Rectangle 1', kind: 'shape' })]);
    const walkNodes = vi.fn(() => {
      const m = new Map<string, { depth: number; parentId: string | null }>();
      m.set('n1', { depth: 0, parentId: null });
      return m;
    });
    const nodeWorldBounds = vi.fn(() => ({ x: 10, y: 20, w: 100, h: 80 }));
    const isWorldRectInViewport = vi.fn(() => true);

    const { container } = render(
      <CanvasAccessibilityTree
        doc={doc}
        camera={{ zoom: 1, pan: { x: 0, y: 0 } }}
        viewport={{ width: 800, height: 600 }}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />,
    );

    const hiddenDiv = container.firstChild as HTMLElement;
    expect(hiddenDiv).not.toBeNull();
    expect(hiddenDiv.getAttribute('aria-hidden')).toBe('false');
    expect(hiddenDiv.className).toContain('sr-only');

    const list = hiddenDiv.querySelector('ul[aria-label="Canvas objects"]');
    expect(list).not.toBeNull();
    const items = hiddenDiv.querySelectorAll('li');
    expect(items.length).toBe(1);

    const item = items[0] as HTMLLIElement;
    expect(item.getAttribute('aria-label')).toContain('Rectangle 1');
    expect(item.getAttribute('aria-label')).toContain('shape');
    expect(item.getAttribute('aria-label')).toContain('10');
    expect(item.getAttribute('aria-label')).toContain('20');
    expect(item.getAttribute('aria-label')).toContain('100');
    expect(item.getAttribute('aria-label')).toContain('80');
  });

  it('off-screen nodes excluded', () => {
    const doc = makeDoc([
      makeNode({ id: 'n1', name: 'Visible', kind: 'shape' }),
      makeNode({ id: 'n2', name: 'Offscreen', kind: 'shape' }),
    ]);
    const walkNodes = vi.fn(() => {
      const m = new Map<string, { depth: number; parentId: string | null }>();
      m.set('n1', { depth: 0, parentId: null });
      m.set('n2', { depth: 0, parentId: null });
      return m;
    });
    const nodeWorldBounds = vi.fn((_doc: Document, id: string) => {
      if (id === 'n1') return { x: 100, y: 100, w: 50, h: 50 };
      if (id === 'n2') return { x: 5000, y: 5000, w: 50, h: 50 };
      return null;
    });
    const isWorldRectInViewport = vi.fn(
      (_cam: unknown, _vp: unknown, rect: { x: number; y: number }) => rect.x < 200,
    );

    const { container } = render(
      <CanvasAccessibilityTree
        doc={doc}
        camera={{ zoom: 1, pan: { x: 0, y: 0 } }}
        viewport={{ width: 800, height: 600 }}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />,
    );

    const items = container.querySelectorAll('li');
    expect(items.length).toBe(1);
    expect(items[0]?.getAttribute('aria-label')).toContain('Visible');
    // isWorldRectInViewport called for both nodes
    expect(isWorldRectInViewport).toHaveBeenCalledTimes(2);
  });

  it('updates when viewport changes', () => {
    const doc = makeDoc([makeNode({ id: 'n1', name: 'Rect', kind: 'shape' })]);
    const walkNodes = vi.fn(() => {
      const m = new Map<string, { depth: number; parentId: string | null }>();
      m.set('n1', { depth: 0, parentId: null });
      return m;
    });
    const nodeWorldBounds = vi.fn(() => ({ x: 0, y: 0, w: 100, h: 100 }));
    const isWorldRectInViewport = vi.fn(() => true);

    const { container, rerender } = render(
      <CanvasAccessibilityTree
        doc={doc}
        camera={{ zoom: 1, pan: { x: 0, y: 0 } }}
        viewport={{ width: 800, height: 600 }}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />,
    );

    expect(container.querySelectorAll('li').length).toBe(1);

    // Re-render with different viewport — walkNodes and nodeWorldBounds called again
    isWorldRectInViewport.mockClear();
    isWorldRectInViewport.mockReturnValue(false);

    rerender(
      <CanvasAccessibilityTree
        doc={doc}
        camera={{ zoom: 3, pan: { x: 0, y: 0 } }}
        viewport={{ width: 400, height: 300 }}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />,
    );

    expect(container.querySelectorAll('li').length).toBe(0);
  });

  it('updates when document changes', () => {
    const doc1 = makeDoc([makeNode({ id: 'n1', name: 'Rect A', kind: 'shape' })]);
    const doc2 = makeDoc([makeNode({ id: 'n2', name: 'Rect B', kind: 'shape' })]);
    const walkNodes = vi.fn((d: Document) => {
      const m = new Map<string, { depth: number; parentId: string | null }>();
      for (const id of d.rootChildren) {
        m.set(id, { depth: 0, parentId: null });
      }
      return m;
    });
    const nodeWorldBounds = vi.fn(() => ({ x: 0, y: 0, w: 100, h: 100 }));
    const isWorldRectInViewport = vi.fn(() => true);

    const { container, rerender } = render(
      <CanvasAccessibilityTree
        doc={doc1}
        camera={{ zoom: 1, pan: { x: 0, y: 0 } }}
        viewport={{ width: 800, height: 600 }}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />,
    );

    expect(container.querySelectorAll('li').length).toBe(1);
    expect(container.querySelector('li')?.getAttribute('aria-label')).toContain('Rect A');

    rerender(
      <CanvasAccessibilityTree
        doc={doc2}
        camera={{ zoom: 1, pan: { x: 0, y: 0 } }}
        viewport={{ width: 800, height: 600 }}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />,
    );

    const items = container.querySelectorAll('li');
    expect(items.length).toBe(1);
    expect(items[0]?.getAttribute('aria-label')).toContain('Rect B');
  });

  it('descriptions include name, kind, dimensions', () => {
    const doc = makeDoc([
      makeNode({
        id: 'n1',
        name: 'My Circle',
        kind: 'shape',
        shape: { kind: 'circle', cx: 50, cy: 50, r: 30 },
      }),
    ]);
    const walkNodes = vi.fn(() => {
      const m = new Map<string, { depth: number; parentId: string | null }>();
      m.set('n1', { depth: 0, parentId: null });
      return m;
    });
    const nodeWorldBounds = vi.fn(() => ({ x: 20, y: 20, w: 60, h: 60 }));
    const isWorldRectInViewport = vi.fn(() => true);

    const { container } = render(
      <CanvasAccessibilityTree
        doc={doc}
        camera={{ zoom: 1, pan: { x: 0, y: 0 } }}
        viewport={{ width: 800, height: 600 }}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />,
    );

    const label = container.querySelector('li')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('My Circle');
    expect(label).toContain('shape');
    expect(label).toContain('20');
    expect(label).toContain('60');
  });

  it('performance: 500 visible nodes render quickly', () => {
    const nodes: SceneNode[] = [];
    for (let i = 0; i < 500; i++) {
      nodes.push(makeNode({ id: `n${i}`, name: `Node ${i}`, kind: 'shape' }));
    }
    const doc = makeDoc(nodes);
    const walkNodes = vi.fn(() => {
      const m = new Map<string, { depth: number; parentId: string | null }>();
      for (let i = 0; i < 500; i++) {
        m.set(`n${i}`, { depth: 0, parentId: null });
      }
      return m;
    });
    const nodeWorldBounds = vi.fn(() => ({ x: 10, y: 10, w: 100, h: 100 }));
    const isWorldRectInViewport = vi.fn(() => true);

    const start = performance.now();
    render(
      <CanvasAccessibilityTree
        doc={doc}
        camera={{ zoom: 1, pan: { x: 0, y: 0 } }}
        viewport={{ width: 800, height: 600 }}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />,
    );
    const elapsed = performance.now() - start;

    // jsdom + React render overhead is slower than production; keep under 2000ms
    expect(elapsed).toBeLessThan(2000);
  });
});

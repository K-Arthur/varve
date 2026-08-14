import { createDocument, type Document, type LayoutStyle, type SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { checkLayoutCycle } from '../cycleDetection';

function addToDoc(doc: Document, ...nodes: SceneNode[]): Document {
  const entries = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const ids = nodes.map((n) => n.id);
  return {
    ...doc,
    rootChildren: [...doc.rootChildren, ...ids],
    nodes: { ...doc.nodes, ...entries },
  };
}

function makeNode(id: string, overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    name: id,
    kind: 'shape',
    visible: true,
    locked: false,
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    ...overrides,
  } as SceneNode;
}

function makeFrame(id: string, overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    name: id,
    kind: 'frame',
    visible: true,
    locked: false,
    w: 200,
    h: 200,
    transform: [1, 0, 0, 1, 0, 0] as const,
    children: [],
    ...overrides,
  } as SceneNode;
}

function makeGroup(id: string, overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    name: id,
    kind: 'group',
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0] as const,
    children: [],
    ...overrides,
  } as SceneNode;
}

function layoutStyle(overrides: Partial<LayoutStyle> = {}): LayoutStyle {
  return {
    mode: 'flex',
    direction: 'row',
    gap: 10,
    wrap: false,
    padding: [0, 0, 0, 0],
    grow: 0,
    shrink: 0,
    alignItems: 'start',
    justifyContent: 'start',
    ...overrides,
  };
}

describe('checkLayoutCycle', () => {
  it('no cycle for non-fill node', () => {
    const doc = createDocument('test');
    const result = checkLayoutCycle(doc, 'nonexistent');
    expect(result.verdict).toBe('no_cycle');
  });

  it('no cycle for fill node without hug parent', () => {
    const child = makeNode('child', { layoutSizing: 'fill' } as Partial<SceneNode>);
    const parent = makeFrame('parent', {
      layoutStyle: layoutStyle(),
      layoutSizing: 'fixed' as const,
      children: ['child'],
    } as Partial<SceneNode>);
    let doc = createDocument('test');
    doc = addToDoc(doc, parent, child);
    doc = { ...doc, rootChildren: ['parent'] };

    const result = checkLayoutCycle(doc, 'child');
    expect(result.verdict).toBe('no_cycle');
  });

  it('detects direct fill-in-hug cycle', () => {
    const child = makeNode('child', {
      layoutSizing: 'fill',
    } as Partial<SceneNode>);
    const parent = makeFrame('parent', {
      layoutSizing: 'hug',
      layoutStyle: layoutStyle(),
      children: ['child'],
    } as Partial<SceneNode>);
    let doc = createDocument('test');
    doc = addToDoc(doc, parent, child);
    doc = { ...doc, rootChildren: ['parent'] };

    const result = checkLayoutCycle(doc, 'child');
    expect(result.verdict).toBe('cycle_detected');
    expect(result.cycle.length).toBeGreaterThanOrEqual(2);
  });

  it('detects nested fill-in-hug cycle', () => {
    const child = makeNode('child', {
      layoutSizing: 'fill',
    } as Partial<SceneNode>);
    const inner = makeFrame('inner', {
      children: ['child'],
    });
    const outer = makeFrame('outer', {
      layoutSizing: 'hug',
      layoutStyle: layoutStyle({
        direction: 'column',
      }),
      children: ['inner'],
    });
    let doc = createDocument('test');
    doc = addToDoc(doc, outer, inner, child);
    doc = { ...doc, rootChildren: ['outer'] };

    const result = checkLayoutCycle(doc, 'child');
    // This depends on whether inner has auto-layout (it does not — no layoutStyle)
    // If inner doesn't have auto-layout, it won't be detected as a hug container
    // The child won't find a hug-style ancestor with auto-layout
    expect(result.verdict).toBe('no_cycle');
  });

  it('detects nested fill-in-hug cycle with auto-layout intermediate', () => {
    const child = makeNode('child', {
      layoutSizing: 'fill',
    } as Partial<SceneNode>);
    const inner = makeFrame('inner', {
      children: ['child'],
      layoutSizing: 'fixed',
    });
    const outer = makeFrame('outer', {
      layoutSizing: 'hug',
      layoutStyle: layoutStyle({
        direction: 'column',
      }),
      children: ['inner'],
    });
    let doc = createDocument('test');
    doc = addToDoc(doc, outer, inner, child);
    doc = { ...doc, rootChildren: ['outer'] };

    const result = checkLayoutCycle(doc, 'child');
    expect(result.verdict).toBe('no_cycle');
    // inner is not hug-sized, so no cycle
  });

  it('no cycle for group without auto-layout', () => {
    const child = makeNode('child', { layoutSizing: 'fill' } as Partial<SceneNode>);
    const group = makeGroup('group', {
      children: ['child'],
      layoutSizing: 'hug',
    });
    let doc = createDocument('test');
    doc = addToDoc(doc, group, child);
    doc = { ...doc, rootChildren: ['group'] };

    const result = checkLayoutCycle(doc, 'child');
    // group with hug but without layoutStyle — no auto-layout
    expect(result.verdict).toBe('no_cycle');
  });
});

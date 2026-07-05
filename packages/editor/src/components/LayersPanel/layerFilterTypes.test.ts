import { makeFrameNode, makeShapeNode, nextNodeId, createDocument } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { nodeMatchesFilter, type LayerFilterSpec, DEFAULT_FILTER } from './layerFilterTypes';
import type { Affine } from '@strata/engine';

function makeTestShape(overrides: Record<string, unknown> = {}) {
  const { id } = nextNodeId(createDocument());
  const node = makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    {
      name: 'Test Shape',
      blendMode: 'normal',
      locked: false,
      visible: true,
      ...overrides,
    },
  );
  return node;
}

function makeTestText(overrides: Record<string, unknown> = {}) {
  const { id } = nextNodeId(createDocument());
  const node = makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    {
      name: 'Test Text',
      blendMode: 'normal',
      locked: false,
      visible: true,
      ...overrides,
    },
  ) as unknown as import('@strata/scene').SceneNode;
  return {
    ...node,
    kind: 'text' as const,
    text: 'hello',
    fontSize: 16,
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    strokes: [],
    effects: [],
  };
}

function makeTestFrame(overrides: Record<string, unknown> = {}) {
  const { id } = nextNodeId(createDocument());
  const node = makeFrameNode(id, {
    name: 'Test Frame',
    w: 100,
    h: 100,
    blendMode: 'normal',
    locked: false,
    visible: true,
    effects: [],
    strokes: [],
    children: [],
    ...overrides,
  });
  return node;
}

function makeTestGroup(overrides: Record<string, unknown> = {}) {
  const { id } = nextNodeId(createDocument());
  const node = makeFrameNode(id, {
    name: 'Test Group',
    w: 100,
    h: 100,
    blendMode: 'normal',
    locked: false,
    visible: true,
    effects: [],
    strokes: [],
    children: [],
    ...overrides,
  });
  return { ...node, kind: 'group' as const };
}

describe('nodeMatchesFilter', () => {
  it('matches all nodes with default filter', () => {
    const shape = makeTestShape();
    expect(nodeMatchesFilter(shape, DEFAULT_FILTER)).toBe(true);
    const text = makeTestText();
    expect(nodeMatchesFilter(text, DEFAULT_FILTER)).toBe(true);
  });

  it('filters by search text (case-insensitive)', () => {
    const node = makeTestShape({ name: 'MyRectangle 1' });
    expect(nodeMatchesFilter(node, { ...DEFAULT_FILTER, search: 'rect' })).toBe(true);
    expect(nodeMatchesFilter(node, { ...DEFAULT_FILTER, search: 'RECT' })).toBe(true);
    expect(nodeMatchesFilter(node, { ...DEFAULT_FILTER, search: 'circle' })).toBe(false);
  });

  it('filters by node kind', () => {
    const shape = makeTestShape();
    const text = makeTestText();
    expect(nodeMatchesFilter(shape, { ...DEFAULT_FILTER, kinds: ['shape'] })).toBe(true);
    expect(nodeMatchesFilter(text, { ...DEFAULT_FILTER, kinds: ['shape'] })).toBe(false);
    expect(nodeMatchesFilter(text, { ...DEFAULT_FILTER, kinds: ['text'] })).toBe(true);
  });

  it('filters by multiple kinds (OR within kinds array)', () => {
    const shape = makeTestShape();
    const text = makeTestText();
    const filter = { ...DEFAULT_FILTER, kinds: ['text', 'shape'] as LayerFilterSpec['kinds'] };
    expect(nodeMatchesFilter(shape, filter)).toBe(true);
    expect(nodeMatchesFilter(text, filter)).toBe(true);
  });

  it('filters by locked state', () => {
    const locked = makeTestShape({ locked: true });
    const unlocked = makeTestShape({ locked: false });
    expect(nodeMatchesFilter(locked, { ...DEFAULT_FILTER, attributes: { locked: true } })).toBe(
      true,
    );
    expect(nodeMatchesFilter(unlocked, { ...DEFAULT_FILTER, attributes: { locked: true } })).toBe(
      false,
    );
    expect(nodeMatchesFilter(unlocked, { ...DEFAULT_FILTER, attributes: { locked: false } })).toBe(
      true,
    );
  });

  it('filters by visible state', () => {
    const visible = makeTestShape({ visible: true });
    const hidden = makeTestShape({ visible: false });
    expect(nodeMatchesFilter(visible, { ...DEFAULT_FILTER, attributes: { visible: true } })).toBe(
      true,
    );
    expect(nodeMatchesFilter(hidden, { ...DEFAULT_FILTER, attributes: { visible: false } })).toBe(
      true,
    );
    expect(nodeMatchesFilter(hidden, { ...DEFAULT_FILTER, attributes: { visible: true } })).toBe(
      false,
    );
  });

  it('filters by blend mode', () => {
    const normal = makeTestShape({ blendMode: 'normal' });
    const multiply = makeTestShape({ blendMode: 'multiply' });
    expect(nodeMatchesFilter(normal, { ...DEFAULT_FILTER, blendModes: ['normal'] })).toBe(true);
    expect(nodeMatchesFilter(multiply, { ...DEFAULT_FILTER, blendModes: ['normal'] })).toBe(false);
    expect(nodeMatchesFilter(multiply, { ...DEFAULT_FILTER, blendModes: ['multiply'] })).toBe(true);
  });

  it('filters by hasChildren', () => {
    const parent = makeTestGroup({ children: ['child1'] });
    const leaf = makeTestShape();
    expect(
      nodeMatchesFilter(parent, { ...DEFAULT_FILTER, attributes: { hasChildren: true } }),
    ).toBe(true);
    expect(nodeMatchesFilter(leaf, { ...DEFAULT_FILTER, attributes: { hasChildren: true } })).toBe(
      false,
    );
  });

  it('filters by no children', () => {
    const emptyContainer = makeTestGroup({ children: [] });
    expect(
      nodeMatchesFilter(emptyContainer, { ...DEFAULT_FILTER, attributes: { hasChildren: false } }),
    ).toBe(true);
  });

  it('filters by hasEffects', () => {
    const withFx = makeTestShape({
      effects: [
        {
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 4,
          spread: 0,
          color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
          opacity: 0.5,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
    });
    const withoutFx = makeTestShape({ effects: [] });
    expect(nodeMatchesFilter(withFx, { ...DEFAULT_FILTER, attributes: { hasEffects: true } })).toBe(
      true,
    );
    expect(
      nodeMatchesFilter(withoutFx, { ...DEFAULT_FILTER, attributes: { hasEffects: true } }),
    ).toBe(false);
  });

  it('filters by isMasked', () => {
    const base = makeTestGroup();
    const masked = {
      ...base,
      mask: { type: 'clip' as const, sourceNodeId: 'child1' as string, visible: true },
    };
    const unmasked = makeTestGroup();
    expect(nodeMatchesFilter(masked, { ...DEFAULT_FILTER, attributes: { isMasked: true } })).toBe(
      true,
    );
    expect(nodeMatchesFilter(unmasked, { ...DEFAULT_FILTER, attributes: { isMasked: true } })).toBe(
      false,
    );
  });

  it('filters by component (frame with componentId)', () => {
    const comp = makeTestFrame({ componentId: 'comp-1' });
    const plain = makeTestFrame();
    expect(nodeMatchesFilter(comp, { ...DEFAULT_FILTER, attributes: { isComponent: true } })).toBe(
      true,
    );
    expect(nodeMatchesFilter(plain, { ...DEFAULT_FILTER, attributes: { isComponent: true } })).toBe(
      false,
    );
  });

  it('combines search + kind + attribute with AND logic', () => {
    const node = makeTestShape({ name: 'My Shape', locked: true, blendMode: 'multiply' });
    const filter: LayerFilterSpec = {
      search: 'shape',
      kinds: ['shape'],
      attributes: { locked: true },
      blendModes: ['multiply'],
    };
    expect(nodeMatchesFilter(node, filter)).toBe(true);

    const wrongKind: LayerFilterSpec = { ...filter, kinds: ['text'] };
    expect(nodeMatchesFilter(node, wrongKind)).toBe(false);

    const wrongAttr: LayerFilterSpec = { ...filter, attributes: { locked: false } };
    expect(nodeMatchesFilter(node, wrongAttr)).toBe(false);

    const wrongBlend: LayerFilterSpec = { ...filter, blendModes: ['screen'] };
    expect(nodeMatchesFilter(node, wrongBlend)).toBe(false);
  });

  it('returns false when no match for any dimension', () => {
    const node = makeTestShape({ name: 'UniqueName' });
    expect(nodeMatchesFilter(node, { ...DEFAULT_FILTER, search: 'nonexistent' })).toBe(false);
  });

  it('handles undefined blendMode gracefully', () => {
    const node = {
      ...makeTestShape(),
      blendMode: undefined,
    } as unknown as import('@strata/scene').SceneNode;
    expect(nodeMatchesFilter(node, { ...DEFAULT_FILTER, blendModes: ['normal'] })).toBe(false);
  });

  it('filters by layerColor', () => {
    const redNode = makeTestShape({ layerColor: 'red' });
    const blueNode = makeTestShape({ layerColor: 'blue' });
    const uncolored = makeTestShape({ layerColor: null });
    expect(
      nodeMatchesFilter(redNode, { ...DEFAULT_FILTER, attributes: { layerColor: 'red' } }),
    ).toBe(true);
    expect(
      nodeMatchesFilter(blueNode, { ...DEFAULT_FILTER, attributes: { layerColor: 'red' } }),
    ).toBe(false);
    expect(
      nodeMatchesFilter(uncolored, { ...DEFAULT_FILTER, attributes: { layerColor: 'red' } }),
    ).toBe(false);
  });

  it('filters by layerColor null (uncolored)', () => {
    const colored = makeTestShape({ layerColor: 'green' });
    const uncolored = makeTestShape({ layerColor: null });
    expect(
      nodeMatchesFilter(colored, { ...DEFAULT_FILTER, attributes: { layerColor: null } }),
    ).toBe(false);
    expect(
      nodeMatchesFilter(uncolored, { ...DEFAULT_FILTER, attributes: { layerColor: null } }),
    ).toBe(true);
  });
});

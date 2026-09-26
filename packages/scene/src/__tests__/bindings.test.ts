import { describe, expect, it } from 'vitest';
import { applyBindingsToNode, stripBindingForVariable } from '../bindings';
import { defaultStroke, type Fill, type SceneNode } from '../types';
import { createVariableStore } from '../variables';

function makeStore(): ReturnType<typeof createVariableStore> {
  const store = createVariableStore(['default']);
  store.variables = {
    v1: { id: 'v1', name: 'myVar', type: 'number', valuesByMode: { default: 42 } },
    v2: { id: 'v2', name: 'widthVar', type: 'number', valuesByMode: { default: 300 } },
    v3: { id: 'v3', name: 'heightVar', type: 'number', valuesByMode: { default: 200 } },
    v4: { id: 'v4', name: 'xVar', type: 'number', valuesByMode: { default: 100 } },
    v5: { id: 'v5', name: 'yVar', type: 'number', valuesByMode: { default: 50 } },
    v6: {
      id: 'v6',
      name: 'fillVar',
      type: 'color',
      valuesByMode: { default: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
    },
    v7: { id: 'v7', name: 'textVar', type: 'string', valuesByMode: { default: 'Hello' } },
    v8: { id: 'v8', name: 'opacityVar', type: 'number', valuesByMode: { default: 0.5 } },
  };
  store.collections.c1 = {
    id: 'c1',
    name: 'Test',
    modes: ['default'],
    activeMode: 'default',
    variableIds: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'],
  };
  store.activeCollectionId = 'c1';
  return store;
}

function makeShapeNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'n1',
    name: 'Test',
    kind: 'shape',
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 10, 20],
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    ...overrides,
  } as SceneNode;
}

function makeFrameNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'n1',
    name: 'Frame',
    kind: 'frame',
    w: 200,
    h: 150,
    transform: [1, 0, 0, 1, 0, 0],
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    children: [],
    bindings: {},
    ...overrides,
  } as SceneNode;
}

function makeTextNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'n1',
    name: 'Text',
    kind: 'text',
    text: 'Sample',
    fontSize: 16,
    w: 100,
    h: 20,
    transform: [1, 0, 0, 1, 0, 0],
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    ...overrides,
  } as SceneNode;
}

describe('applyBindingsToNode', () => {
  it('returns node unchanged when no store', () => {
    const node = makeShapeNode({ bindings: { x: { variableId: 'v4' } } });
    const result = applyBindingsToNode(node, undefined);
    expect(result.transform[4]).toBe(10);
  });

  it('returns node unchanged when no bindings', () => {
    const node = makeShapeNode({ bindings: undefined });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect(result).toBe(node);
  });

  it('binds x to transform tx', () => {
    const node = makeShapeNode({ bindings: { x: { variableId: 'v4' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect(result.transform[4]).toBe(100);
    expect(result.transform[5]).toBe(20);
  });

  it('binds y to transform ty', () => {
    const node = makeShapeNode({ bindings: { y: { variableId: 'v5' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect(result.transform[4]).toBe(10);
    expect(result.transform[5]).toBe(50);
  });

  it('binds width to shape rect w', () => {
    const node = makeShapeNode({ bindings: { width: { variableId: 'v2' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    const s = (result as { shape: { kind: string; w: number; h: number } }).shape;
    if (s.kind === 'rect') {
      expect(s.w).toBe(300);
    } else {
      expect.unreachable('expected rect shape');
    }
  });

  it('binds height to shape rect h', () => {
    const node = makeShapeNode({ bindings: { height: { variableId: 'v3' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    const s = (result as { shape: { kind: string; w: number; h: number } }).shape;
    if (s.kind === 'rect') {
      expect(s.h).toBe(200);
    }
  });

  it('binds width to frame w', () => {
    const node = makeFrameNode({ bindings: { width: { variableId: 'v2' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect((result as typeof node & { w: number }).w).toBe(300);
  });

  it('binds height to frame h', () => {
    const node = makeFrameNode({ bindings: { height: { variableId: 'v3' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect((result as typeof node & { h: number }).h).toBe(200);
  });

  it('binds width to text w', () => {
    const node = makeTextNode({ bindings: { width: { variableId: 'v2' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect((result as typeof node & { w: number }).w).toBe(300);
  });

  it('binds w as alias for width', () => {
    const node = makeShapeNode({ bindings: { w: { variableId: 'v2' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    const s = (result as { shape: { kind: string; w: number; h: number } }).shape;
    if (s.kind === 'rect') {
      expect(s.w).toBe(300);
    }
  });

  it('binds h as alias for height', () => {
    const node = makeFrameNode({ bindings: { h: { variableId: 'v3' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect((result as typeof node & { h: number }).h).toBe(200);
  });

  it('binds rotation', () => {
    const node = makeShapeNode({ bindings: { rotation: { variableId: 'v1' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect(result.rotation).toBe(42);
  });

  it('binds opacity', () => {
    const node = makeShapeNode({ bindings: { opacity: { variableId: 'v8' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect(result.opacity).toBe(0.5);
  });

  it('binds fill color', () => {
    const node = makeShapeNode({ bindings: { fill: { variableId: 'v6' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect(result.fill).toEqual({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
  });

  it('binds text content', () => {
    const node = makeTextNode({ bindings: { text: { variableId: 'v7' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect((result as typeof node & { text: string }).text).toBe('Hello');
  });

  it('binds fontSize for text nodes', () => {
    const node = makeTextNode({ bindings: { fontSize: { variableId: 'v1' } } });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect((result as typeof node & { fontSize: number }).fontSize).toBe(42);
  });

  it('handles broken binding gracefully', () => {
    const node = makeShapeNode({ bindings: { x: { variableId: 'nonexistent' } }, opacity: 0.8 });
    const store = makeStore();
    const result = applyBindingsToNode(node, store);
    expect(result.transform[4]).toBe(10);
    expect(result.opacity).toBe(0.8);
  });
});

function solidFill(r: number, g: number, b: number): Fill {
  return {
    type: 'solid',
    color: { space: 'rgb', r, g, b, a: 255 },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

function gradientFill(): Fill {
  return {
    type: 'gradient',
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    gradient: {
      type: 'linear',
      stops: [
        { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
        { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
      ],
    },
  };
}

describe('applyBindingsToNode — paint stacks, radius, typography, stroke weight', () => {
  const numericVariables: Record<string, { name: string; value: number }> = {
    v10: { name: 'radiusVar', value: 12 },
    v11: { name: 'lineHeightVar', value: 1.5 },
    v12: { name: 'letterSpacingVar', value: 2 },
    v13: { name: 'trackingVar', value: 40 },
    v14: { name: 'paragraphSpacingVar', value: 8 },
    v15: { name: 'strokeWeightVar', value: 3 },
  };

  function storeWithNumericVariables(): ReturnType<typeof makeStore> {
    const store = makeStore();
    for (const [id, def] of Object.entries(numericVariables)) {
      store.variables[id] = {
        id,
        name: def.name,
        type: 'number',
        valuesByMode: { default: def.value },
      };
      store.collections.c1?.variableIds.push(id);
    }
    return store;
  }

  it('applies a fill binding to the primary solid fill of a fills stack', () => {
    const second = solidFill(0, 255, 0);
    const node = makeShapeNode({
      bindings: { fill: { variableId: 'v6' } },
      fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
      fills: [solidFill(10, 20, 30), second],
    } as Partial<SceneNode>);
    const result = applyBindingsToNode(node, makeStore());
    const fills = (result as { fills?: Array<{ color?: unknown }> }).fills;
    expect(fills?.[0]?.color).toEqual({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    // The authored legacy fill is not the painted slot and must not be
    // rewritten — the binding drives what the renderer actually paints.
    expect(result.fill).toEqual({ space: 'rgb', r: 0, g: 0, b: 255, a: 255 });
    // Untouched secondary paint keeps its own colour.
    expect(fills?.[1]?.color).toEqual({ space: 'rgb', r: 0, g: 255, b: 0, a: 255 });
  });

  it('preserves the primary fill opacity and paint options when binding', () => {
    const node = makeShapeNode({
      bindings: { fill: { variableId: 'v6' } },
      fills: [{ ...solidFill(10, 20, 30), opacity: 0.25, blendMode: 'multiply' }],
    } as Partial<SceneNode>);
    const result = applyBindingsToNode(node, makeStore());
    const primary = (result as { fills?: Array<Record<string, unknown>> }).fills?.[0];
    expect(primary).toMatchObject({ opacity: 0.25, blendMode: 'multiply' });
    expect(primary?.color).toEqual({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
  });

  it('never flattens a gradient primary paint into the bound colour', () => {
    const node = makeShapeNode({
      bindings: { fill: { variableId: 'v6' } },
      fills: [gradientFill()],
    } as Partial<SceneNode>);
    const result = applyBindingsToNode(node, makeStore());
    const primary = (result as { fills?: Array<Record<string, unknown>> }).fills?.[0];
    expect(primary?.type).toBe('gradient');
    expect(primary?.gradient).toBeDefined();
  });

  it('does not silently break a shared paint reference', () => {
    const node = makeShapeNode({
      bindings: { fill: { variableId: 'v6' } },
      paintRefs: ['paint-1'],
    } as Partial<SceneNode>);
    const result = applyBindingsToNode(node, makeStore());
    expect(result).toEqual(node);
  });

  it('binds cornerRadius on shapes', () => {
    const node = makeShapeNode({ bindings: { cornerRadius: { variableId: 'v10' } } });
    const result = applyBindingsToNode(node, storeWithNumericVariables());
    expect((result as { cornerRadius?: number }).cornerRadius).toBe(12);
  });

  it('binds cornerRadius on frames', () => {
    const node = makeFrameNode({ bindings: { cornerRadius: { variableId: 'v10' } } });
    const result = applyBindingsToNode(node, storeWithNumericVariables());
    expect((result as { cornerRadius?: number }).cornerRadius).toBe(12);
  });

  it('binds lineHeight, letterSpacing, tracking and paragraphSpacing on text', () => {
    const node = makeTextNode({
      bindings: {
        lineHeight: { variableId: 'v11' },
        letterSpacing: { variableId: 'v12' },
        tracking: { variableId: 'v13' },
        paragraphSpacing: { variableId: 'v14' },
      },
    });
    const result = applyBindingsToNode(node, storeWithNumericVariables()) as {
      lineHeight?: number;
      letterSpacing?: number;
      tracking?: number;
      paragraphSpacing?: number;
    };
    expect(result.lineHeight).toBe(1.5);
    expect(result.letterSpacing).toBe(2);
    expect(result.tracking).toBe(40);
    expect(result.paragraphSpacing).toBe(8);
  });

  it('binds strokeWeight:<stroke id> to that stroke only', () => {
    const node = makeShapeNode({
      bindings: { 'strokeWeight:stroke-a': { variableId: 'v15' } },
      strokes: [
        { ...defaultStroke(), id: 'stroke-a', weight: 1 },
        { ...defaultStroke(), id: 'stroke-b', weight: 5 },
      ],
    } as Partial<SceneNode>);
    const result = applyBindingsToNode(node, storeWithNumericVariables());
    const strokes = (result as { strokes?: Array<{ weight?: number }> }).strokes;
    expect(strokes?.[0]?.weight).toBe(3);
    expect(strokes?.[1]?.weight).toBe(5);
  });

  it('binds strokeWeight for strokes without ids by legacy row index', () => {
    const node = makeShapeNode({
      bindings: { 'strokeWeight:legacy-stroke-1': { variableId: 'v15' } },
      strokes: [
        { ...defaultStroke(), weight: 1 },
        { ...defaultStroke(), weight: 5 },
      ],
    } as Partial<SceneNode>);
    const result = applyBindingsToNode(node, storeWithNumericVariables());
    const strokes = (result as { strokes?: Array<{ weight?: number }> }).strokes;
    expect(strokes?.[0]?.weight).toBe(1);
    expect(strokes?.[1]?.weight).toBe(3);
  });
});

describe('stripBindingForVariable', () => {
  it('removes bindings referencing a variable id', () => {
    const bindings = {
      x: { variableId: 'v1' },
      y: { variableId: 'v2' },
      width: { variableId: 'v1' },
    };
    const result = stripBindingForVariable(bindings, 'v1');
    expect(result).toEqual({ y: { variableId: 'v2' } });
  });

  it('returns undefined when all bindings removed', () => {
    const bindings = { x: { variableId: 'v1' } };
    const result = stripBindingForVariable(bindings, 'v1');
    expect(result).toBeUndefined();
  });

  it('returns same object when no binding references the variable', () => {
    const bindings = { x: { variableId: 'v1' } };
    const result = stripBindingForVariable(bindings, 'v2');
    expect(result).toBe(bindings);
  });

  it('returns undefined for undefined input', () => {
    const result = stripBindingForVariable(undefined, 'v1');
    expect(result).toBeUndefined();
  });
});

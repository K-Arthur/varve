import { describe, expect, it } from 'vitest';
import { applyBindingsToNode, stripBindingForVariable } from '../bindings';
import type { SceneNode } from '../types';
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

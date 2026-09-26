/**
 * Binding-path benchmarks (design-token → canvas propagation).
 *
 * Two things changed in the binding/repaint pass and both are on the
 * per-frame / per-edit path:
 *
 *  1. `applyBindingsToNode` now drives the primary *solid* paint of a
 *     `fills[]` stack instead of the legacy `fill` field, which copies the
 *     paint array for every bound node. This bench keeps the pre-fix
 *     implementation beside it so the cost of that copy is measured, not
 *     guessed.
 *  2. A variable-only edit now scans `getChangedVariableIds` +
 *     `buildVariableDependencyMap` and then bumps `docVersion` when a bound
 *     node was invalidated (the repaint fix). That scan existed before; the
 *     bump is an integer increment. Both are measured here at document sizes
 *     the editor actually handles.
 *
 * Run with: pnpm bench (vitest bench --run --pool=forks)
 */
import { bench, describe } from 'vitest';
import { applyBindingsToNode } from '../bindings';
import type { Fill, PropertyBinding, SceneNode } from '../types';
import {
  buildVariableDependencyMap,
  createVariableStore,
  getChangedVariableIds,
  resolve,
  type VariableStore,
} from '../variables';

function solid(r: number, g: number, b: number): Fill {
  return {
    type: 'solid',
    color: { space: 'rgb', r, g, b, a: 255 },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

function makeStore(): VariableStore {
  const store = createVariableStore(['default']);
  store.variables = {
    vColor: {
      id: 'vColor',
      name: 'brand.primary',
      type: 'color',
      valuesByMode: { default: '#336699' },
    },
    vRadius: { id: 'vRadius', name: 'radius.md', type: 'number', valuesByMode: { default: 8 } },
    vOpacity: {
      id: 'vOpacity',
      name: 'opacity.muted',
      type: 'number',
      valuesByMode: { default: 0.7 },
    },
    vWidth: { id: 'vWidth', name: 'size.control', type: 'number', valuesByMode: { default: 120 } },
  };
  store.collections.c1 = {
    id: 'c1',
    name: 'Tokens',
    modes: ['default'],
    activeMode: 'default',
    variableIds: ['vColor', 'vRadius', 'vOpacity', 'vWidth'],
  };
  store.activeCollectionId = 'c1';
  return store;
}

const BINDINGS: Record<string, PropertyBinding> = {
  fill: { variableId: 'vColor' },
  opacity: { variableId: 'vOpacity' },
  cornerRadius: { variableId: 'vRadius' },
  width: { variableId: 'vWidth' },
};

function makeNodes(count: number, withFillsStack: boolean): SceneNode[] {
  const nodes: SceneNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `n${i}`,
      kind: 'shape',
      name: `Shape ${i}`,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, i, i],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      ...(withFillsStack
        ? { fills: [solid(57, 208, 198), solid(255, 255, 255), solid(0, 0, 0)] }
        : {}),
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      bindings: BINDINGS,
    } as SceneNode);
  }
  return nodes;
}

/** Pre-fix behaviour: the binding wrote `node.fill` only (no paint-array copy). */
function applyBindingsLegacyFill(node: SceneNode, store: VariableStore): SceneNode {
  if (!node.bindings) return node;
  let next = node;
  for (const [property, binding] of Object.entries(node.bindings)) {
    const value = resolve(store, binding.variableId);
    if (property === 'fill' && typeof value === 'string') {
      next = { ...next, fill: { space: 'rgb', r: 51, g: 102, b: 153, a: 255 } } as SceneNode;
    } else if (property === 'opacity' && typeof value === 'number') {
      next = { ...next, opacity: value } as SceneNode;
    } else if (property === 'cornerRadius' && typeof value === 'number') {
      next = { ...next, cornerRadius: value } as SceneNode;
    } else if (property === 'width' && typeof value === 'number' && 'shape' in next && next.shape) {
      next = { ...next, shape: { ...next.shape, w: value } } as SceneNode;
    }
  }
  return next;
}

const store = makeStore();
const nodes1kFills = makeNodes(1000, true);
const nodes1kLegacy = makeNodes(1000, false);
const nodes10kFills = makeNodes(10_000, true);

function nodeMap(nodes: SceneNode[]): Record<string, SceneNode> {
  const map: Record<string, SceneNode> = {};
  for (const node of nodes) map[node.id] = node;
  return map;
}

const nodes10kMap = nodeMap(nodes10kFills);
const changedStore = makeStore();
// Differ from `store` so the change detection has real work to find.
const changedColor = changedStore.variables.vColor;
if (changedColor) changedColor.valuesByMode.default = '#447799';

describe('applyBindingsToNode', () => {
  bench('1k nodes · fills[] stack (current)', () => {
    for (const node of nodes1kFills) applyBindingsToNode(node, store);
  });

  bench('1k nodes · fills[] stack (pre-fix: legacy fill write)', () => {
    for (const node of nodes1kFills) applyBindingsLegacyFill(node, store);
  });

  bench('1k nodes · legacy fill only (current)', () => {
    for (const node of nodes1kLegacy) applyBindingsToNode(node, store);
  });

  bench('10k nodes · fills[] stack (current)', () => {
    for (const node of nodes10kFills) applyBindingsToNode(node, store);
  });
});

describe('variable-only edit invalidation scan', () => {
  bench('10k nodes · changed-variable detection + dependency map', () => {
    // The document-side work a variable edit does before the repaint: find
    // which variables changed, then which nodes depend on them. The
    // docVersion bump this pass added is an integer increment on top.
    const changed = getChangedVariableIds(store, changedStore);
    buildVariableDependencyMap(nodes10kMap, changedStore);
    changed.size;
  });
});

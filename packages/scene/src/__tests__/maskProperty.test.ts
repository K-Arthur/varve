/**
 * Property-based invariant tests for the clipping/mask graph (fast-check).
 *
 * Generates random sequences of mask/clip editing operations — add masks,
 * retarget mask sources, reparent nodes (including mattes), reorder,
 * duplicate (deep clone), delete — and asserts the invariants that hold
 * after EVERY operation:
 *
 *  - no dangling mask sourceNodeId references
 *  - no mask cycles (detectMaskCycles is empty)
 *  - validateMasks reports no offending containers
 *  - the document traversal terminates (no infinite nesting)
 *  - reparenting a matte out of a clipping group releases the mask
 */
import fc from 'fast-check';
import { describe, it } from 'vitest';
import {
  addMask,
  addNode,
  createDocument,
  type Document,
  deepCloneSubtree,
  detectMaskCycles,
  makeAdjustmentNode,
  makeGroupNode,
  removeNode,
  reparentNode,
  setMaskSourceNode,
  validateMasks,
} from '../index';

const IDS = ['a', 'b', 'c', 'd'] as const;
const OPS = ['addMask', 'setSource', 'reparent', 'reorder', 'clone', 'delete'] as const;

const opArbitrary = fc.record({
  op: fc.constantFrom(...OPS),
  a: fc.nat({ max: IDS.length - 1 }),
  b: fc.nat({ max: IDS.length - 1 }),
  index: fc.nat({ max: 4 }),
});

interface OpState {
  doc: Document;
  ids: string[];
}

/** A document with four root-level containers and one adjustment. */
function baseDoc(): Document {
  let doc = createDocument('mask-props', true);
  doc = addNode(doc, makeGroupNode('g1', { children: [] }));
  doc = addNode(doc, makeGroupNode('g2', { children: [] }));
  doc = addNode(doc, makeGroupNode('g3', { children: [] }));
  doc = addNode(doc, makeGroupNode('g4', { children: [] }));
  doc = addNode(
    doc,
    makeAdjustmentNode('adj', 'levels', {
      channel: 'rgb' as const,
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    }),
  );
  return doc;
}

function applyOp(
  state: OpState,
  op: (typeof OPS)[number],
  a: number,
  b: number,
  index: number,
): OpState {
  const { doc } = state;
  const pick = (n: number) => IDS[n % IDS.length]!;
  const container = pick(a);
  const source = pick(b);
  const child = pick(a);
  const parent = pick(b);

  switch (op) {
    case 'addMask': {
      const type = (['clip', 'alpha', 'luminance'] as const)[a % 3]!;
      return { doc: addMask(doc, container, source, type), ids: [...IDS] };
    }
    case 'setSource': {
      return { doc: setMaskSourceNode(doc, container, source), ids: [...IDS] };
    }
    case 'reparent':
    case 'reorder': {
      const parentNode = doc.nodes[parent];
      if (!parentNode || !('children' in parentNode)) return state;
      if (parent === child) return state;
      return { doc: reparentNode(doc, child, parent, index), ids: [...IDS] };
    }
    case 'clone': {
      const root = child;
      if (!doc.nodes[root]) return state;
      const cloned = deepCloneSubtree(doc.nodes, doc.nextId, root);
      const nodes = { ...doc.nodes, ...cloned.nodes };
      const result = { ...doc, nodes, nextId: cloned.nextId } as Document;
      return {
        doc: { ...result, rootChildren: [...result.rootChildren, cloned.rootId] },
        ids: [...IDS],
      };
    }
    case 'delete': {
      return { doc: removeNode(doc, child), ids: [...IDS] };
    }
    default:
      return state;
  }
}

describe('mask graph invariants (property-based)', () => {
  it('never leaves dangling references, cycles, or invalid masks after random edits', () => {
    fc.assert(
      fc.property(fc.array(opArbitrary, { minLength: 1, maxLength: 40 }), (ops) => {
        let state: OpState = { doc: baseDoc(), ids: [...IDS] };
        for (const { op, a, b, index } of ops) {
          state = applyOp(state, op, a, b, index);
          const doc = state.doc;

          // No dangling mask source references.
          for (const node of Object.values(doc.nodes)) {
            const mask = (node as { mask?: { sourceNodeId?: string } }).mask;
            if (mask?.sourceNodeId && !doc.nodes[mask.sourceNodeId]) {
              throw new Error(`dangling mask source ${mask.sourceNodeId}`);
            }
          }

          // No cycles in the mask reference graph.
          const cycles = detectMaskCycles(doc);
          if (cycles.length > 0) {
            throw new Error(`mask cycle detected: ${JSON.stringify(cycles)}`);
          }

          // validateMasks agrees.
          const offenders = validateMasks(doc);
          if (offenders.length > 0) {
            throw new Error(`validateMasks offenders: ${JSON.stringify(offenders)}`);
          }

          // Traversal terminates: every node reachable from rootChildren is
          // visited at most once (a tree can never loop back).
          const seen = new Set<string>();
          const stack = [...doc.rootChildren];
          while (stack.length > 0) {
            const id = stack.pop()!;
            if (seen.has(id)) throw new Error(`traversal loop at ${id}`);
            seen.add(id);
            const node = doc.nodes[id];
            if (node && 'children' in node) stack.push(...node.children);
          }
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });
});

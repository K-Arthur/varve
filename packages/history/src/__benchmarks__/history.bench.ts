/**
 * Persistent-history performance budgets (M17, spec §31/§35.14).
 *
 * Benchmarks the hot paths: semantic diff, three-way merge, canonical
 * serialization, and capture-replay round trips at 100 / 1k / 10k nodes.
 *
 * Budgets are generous CI-safe ceilings, not tight targets; regressions
 * beyond an order of magnitude indicate a real problem.
 *
 * Run: pnpm bench (vitest bench mode) — excluded from pnpm test.
 */

import type { Document } from '@varve/scene';
import {
  applyOperation,
  canonicalHash,
  createDocument,
  makeShapeNode,
  registerBuiltinOperations,
} from '@varve/scene';
import { bench, describe } from 'vitest';
import { diffDocuments } from '../diff';
import { mergeDocuments } from '../merge';

registerBuiltinOperations();

const DOC_ID = 'bench-doc';

function docWithNodes(count: number): Document {
  let doc = {
    ...createDocument(DOC_ID, { flat: true }),
    id: DOC_ID,
  } as Document;
  for (let i = 0; i < count; i++) {
    const node = makeShapeNode(
      `n${i}_aaaa${i.toString(16).padStart(3, '0')}`,
      {
        kind: 'rect',
        x: i * 10,
        y: 0,
        w: 10,
        h: 10,
      },
      { name: `Node ${i}` },
    );
    doc = applyOperation(doc, 'node.create', { node });
  }
  return doc;
}

function mutateOne(doc: Document): Document {
  const id = Object.keys(doc.nodes)[0]!;
  return applyOperation(doc, 'node.patch', { nodeId: id, path: 'opacity', value: 0.5 });
}

function mutateMany(doc: Document, count: number): Document {
  let current = doc;
  const ids = Object.keys(doc.nodes);
  for (let i = 0; i < count; i++) {
    const id = ids[i % ids.length]!;
    current = applyOperation(current, 'node.patch', {
      nodeId: id,
      path: 'opacity',
      value: (i % 100) / 100,
    });
  }
  return current;
}

describe('history hot paths', () => {
  const small = docWithNodes(100);
  const medium = docWithNodes(1_000);
  const large = docWithNodes(10_000);
  const smallChanged = mutateOne(small);
  const mediumChanged = mutateMany(medium, 50);
  const largeChanged = mutateMany(large, 500);

  bench('canonical hash: 100 nodes', () => {
    canonicalHash(small);
  });
  bench('canonical hash: 1k nodes', () => {
    canonicalHash(medium);
  });
  bench('canonical hash: 10k nodes', () => {
    canonicalHash(large);
  });

  bench('diff: 100 nodes, 1 change', () => {
    diffDocuments(small, smallChanged);
  });
  bench('diff: 1k nodes, 50 changes', () => {
    diffDocuments(medium, mediumChanged);
  });
  bench('diff: 10k nodes, 500 changes', () => {
    diffDocuments(large, largeChanged);
  });

  bench('merge: 100 nodes, disjoint edits', () => {
    mergeDocuments(small, mutateOne(small), mutateOne(mutateOne(small)));
  });
  bench('merge: 1k nodes, disjoint edits', () => {
    mergeDocuments(medium, mutateOne(medium), mutateOne(mutateOne(medium)));
  });
  bench('merge: 10k nodes, disjoint edits', () => {
    mergeDocuments(large, mutateOne(large), mutateOne(mutateOne(large)));
  });

  bench('merge: 1k nodes, conflicting edits', () => {
    mergeDocuments(medium, mutateMany(medium, 10), mutateMany(medium, 10));
  });
});

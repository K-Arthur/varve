/**
 * Persistent-history diagnostic measurements (M17, spec §31/§35.14).
 *
 * Benchmarks the hot paths: semantic diff, three-way merge, canonical
 * serialization at 100 / 1k / 10k nodes. Fixture construction is untimed.
 *
 * These report measurements; they do not enforce latency or memory budgets.
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
  const doc = {
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
    // This flat fixture has no ownership, references or shared nodes to
    // reconcile. Assemble it once: replaying N insertions here copies an
    // ever-growing document N times before any timed benchmark can start.
    doc.nodes[node.id] = node;
    doc.rootChildren.push(node.id);
  }
  return doc;
}

function patchFixture(doc: Document, index: number, value: number): Document {
  const id = Object.keys(doc.nodes)[index]!;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id]!, opacity: value } } };
}

function mutateMany(doc: Document, count: number): Document {
  const nodes = { ...doc.nodes };
  const ids = Object.keys(nodes);
  for (let i = 0; i < count; i++) {
    const id = ids[i % ids.length]!;
    nodes[id] = { ...nodes[id]!, opacity: (i % 100) / 100 };
  }
  return { ...doc, nodes };
}

/** Prove the batched setup matches the operation pipeline on a small fixture. */
function verifyFixture(doc: Document): void {
  let reference = { ...createDocument(DOC_ID, { flat: true }), id: DOC_ID } as Document;
  for (const node of Object.values(doc.nodes)) {
    reference = applyOperation(reference, 'node.create', { node });
  }
  if (canonicalHash(reference) !== canonicalHash(doc)) throw new Error('Invalid node fixture');
  const ids = Object.keys(reference.nodes);
  for (let index = 0; index < 50; index++) {
    reference = applyOperation(reference, 'node.patch', {
      nodeId: ids[index % ids.length]!,
      path: 'opacity',
      value: (index % 100) / 100,
    });
  }
  if (canonicalHash(reference) !== canonicalHash(mutateMany(doc, 50))) {
    throw new Error('Invalid edited fixture');
  }
}

describe('history hot paths', () => {
  verifyFixture(docWithNodes(100));
  const measurement = { time: 100, iterations: 1, warmupTime: 0, warmupIterations: 0 };
  for (const [name, count, changes] of [
    ['100 nodes', 100, 1],
    ['1k nodes', 1_000, 50],
    ['10k nodes', 10_000, 500],
  ] as const) {
    const base = docWithNodes(count);
    const changed = mutateMany(base, changes);
    const ours = patchFixture(base, 0, 0.5);
    const theirs = patchFixture(base, 1, 0.25);
    const conflicting = patchFixture(base, 0, 0.25);
    bench(
      `canonical hash: ${name}`,
      () => {
        canonicalHash(base);
      },
      measurement,
    );
    bench(
      `diff: ${name}, ${changes} changes`,
      () => {
        diffDocuments(base, changed);
      },
      measurement,
    );
    bench(
      `merge: ${name}, disjoint edits`,
      () => {
        mergeDocuments(base, ours, theirs);
      },
      measurement,
    );
    bench(
      `merge: ${name}, conflicting edits`,
      () => {
        mergeDocuments(base, ours, conflicting);
      },
      measurement,
    );
  }
});

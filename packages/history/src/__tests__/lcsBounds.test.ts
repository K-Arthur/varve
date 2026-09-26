import type { Document } from '@varve/scene';
import { createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { diffDocuments, lcsIndices } from '../diff';

/** The pre-optimization quadratic implementation, kept as an oracle. */
function referenceLcs(base: readonly string[], target: readonly string[]): Array<[number, number]> {
  const n = base.length;
  const m = target.length;
  if (n === 0 || m === 0) return [];
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] =
        base[i] === target[j]
          ? dp[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(dp[i * (m + 1) + j + 1]!, dp[(i + 1) * (m + 1) + j]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === target[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j]! >= dp[i * (m + 1) + j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function isCommonSubsequence(
  base: readonly string[],
  target: readonly string[],
  pairs: Array<[number, number]>,
): boolean {
  for (let k = 0; k < pairs.length; k++) {
    const [i, j] = pairs[k]!;
    if (base[i] !== target[j]) return false;
    if (k > 0 && (i <= pairs[k - 1]![0] || j <= pairs[k - 1]![1])) return false;
  }
  return true;
}

describe('lcsIndices bounds', () => {
  it('returns the same pairs as the quadratic oracle below the memory cap', () => {
    const random = seededRandom(7);
    for (let round = 0; round < 200; round++) {
      const alphabet = 2 + Math.floor(random() * 6);
      const length = () => Math.floor(random() * 24);
      const pick = () => `n${Math.floor(random() * alphabet)}`;
      const base = Array.from({ length: length() }, pick);
      const target = random() < 0.5 ? [...base] : Array.from({ length: length() }, pick);
      if (random() < 0.5 && target.length > 0)
        target.splice(Math.floor(random() * target.length), 1);
      expect(lcsIndices(base, target)).toEqual(referenceLcs(base, target));
    }
  });

  it('keeps large unique orders bounded and still finds the longest match', () => {
    const count = 20_000;
    const base = Array.from({ length: count }, (_, index) => `node-${index}`);
    // Move the first entry to the end: no common prefix, and a quadratic
    // table would need 400M cells.
    const target = [...base.slice(1), base[0]!];
    const pairs = lcsIndices(base, target);
    expect(pairs).toHaveLength(count - 1);
    expect(isCommonSubsequence(base, target, pairs)).toBe(true);
  });
});

describe('diffDocuments on a large root order', () => {
  it('reports only the edited node when the root order is shared', () => {
    let doc: Document = createDocument('large', true);
    const nodes: Document['nodes'] = { ...doc.nodes };
    const rootChildren = [...doc.rootChildren];
    for (let index = 0; index < 12_000; index++) {
      const id = `rect-${index}`;
      nodes[id] = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      rootChildren.push(id);
    }
    doc = { ...doc, nodes, rootChildren };
    const moved = makeShapeNode(
      'rect-5000',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      {
        transform: [1, 0, 0, 1, 40, 40],
      },
    );
    const edited: Document = { ...doc, nodes: { ...doc.nodes, 'rect-5000': moved } };
    const diff = diffDocuments(doc, edited, { epsilonPolicy: 'exact' });
    expect(diff.changed).toBe(true);
    expect(new Set(diff.changes.map((change) => change.entityId))).toEqual(new Set(['rect-5000']));
  });
});

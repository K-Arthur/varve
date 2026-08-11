/**
 * Dirty-diff baseline invariant — partial redraw must anchor to the
 * document whose pixels are actually on screen.
 *
 * The production paint path diffs the current document against
 * `lastRenderedDocRef` — the document the last COMPLETED frame painted.
 * When a frame is overtaken mid-flight (a document change lands during the
 * async IR build — real on desktop, where `buildIr` is a Tauri IPC await),
 * the frame still paints the captured document, and the surface then shows
 * that document's pixels. The baseline must advance to the PAINTED document,
 * not stall at the previously completed one: a partial frame diffed against
 * the older document misses every pixel the overtaken frame painted, and
 * those pixels (the intermediate drag position, or a deleted node's last
 * painted location) survive as stale ghosts.
 *
 * These tests model the surface as a cell grid and simulate the production
 * sequence exactly:
 *
 *   surface = render(L)
 *   surface ← partial(surface, A, dirty(L → A))   // overtaken frame paints A
 *   surface ← partial(surface, B, dirty(baseline → B))
 *
 * and assert the final surface equals a clean full render of B.
 */

import { addNode, createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { computeDocumentDirtyRegion, type DirtyRegion } from '../dirtyRegion';
import { nodeVisualWorldBounds } from '../visualBounds';

type Document = import('@varve/scene').Document;
type Surface = Map<string, string>;

function rectCells(x: number, y: number, w: number, h: number): string[] {
  const cells: string[] = [];
  for (let cx = Math.floor(x); cx < Math.ceil(x + w); cx++) {
    for (let cy = Math.floor(y); cy < Math.ceil(y + h); cy++) {
      cells.push(`${cx},${cy}`);
    }
  }
  return cells;
}

function docCells(doc: Document, nodeId: string): string[] {
  const bounds = nodeVisualWorldBounds(doc, nodeId);
  if (!bounds) return [];
  return rectCells(bounds.x, bounds.y, bounds.w, bounds.h);
}

/** Paint every node over a board-cleared surface (full render). */
function renderFull(surface: Surface, doc: Document): void {
  surface.clear();
  for (const id of Object.keys(doc.nodes)) {
    for (const cell of docCells(doc, id)) surface.set(cell, id);
  }
}

/** Production partial frame: clear the dirty bounds, repaint contributors inside it. */
function applyPartial(surface: Surface, doc: Document, dirty: DirtyRegion): void {
  if (dirty.kind === 'full') {
    renderFull(surface, doc);
    return;
  }
  if (dirty.kind === 'none') return;
  const region = new Set(rectCells(dirty.bounds.x, dirty.bounds.y, dirty.bounds.w, dirty.bounds.h));
  for (const cell of region) surface.delete(cell);
  for (const id of Object.keys(doc.nodes)) {
    for (const cell of docCells(doc, id)) {
      if (region.has(cell)) surface.set(cell, id);
    }
  }
}

function differingCells(a: Surface, b: Surface): string[] {
  const all = new Set<string>([...a.keys(), ...b.keys()]);
  const diff: string[] = [];
  for (const cell of all) {
    if (a.get(cell) !== b.get(cell)) diff.push(cell);
  }
  return diff;
}

function rectContains(
  rect: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function rectsContain(
  rect: { x: number; y: number; w: number; h: number },
  target: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    rectContains(rect, target.x, target.y) &&
    rectContains(rect, target.x + target.w - 1, target.y + target.h - 1)
  );
}

/** A moving rect: L (0,0) → A (-400,300) → B (400,300) — non-monotonic path. */
function movingDocs(): {
  L: Document;
  A: Document;
  B: Document;
  aBounds: { x: number; y: number; w: number; h: number };
} {
  let L = createDocument('Baseline', true);
  L = addNode(
    L,
    makeShapeNode(
      'x',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
      { transform: [1, 0, 0, 1, 0, 0] as const },
    ),
  );
  const x = L.nodes.x!;
  const A: Document = {
    ...L,
    nodes: { ...L.nodes, x: { ...x, transform: [1, 0, 0, 1, -400, 300] as const } },
  };
  const B: Document = {
    ...L,
    nodes: { ...L.nodes, x: { ...x, transform: [1, 0, 0, 1, 400, 300] as const } },
  };
  return { L, A, B, aBounds: { x: -400, y: 300, w: 40, h: 40 } };
}

/** The node is deleted in B while a frame painted it at an intermediate position. */
function deleteDuringInteractionDocs(): {
  L: Document;
  A: Document;
  B: Document;
  aBounds: { x: number; y: number; w: number; h: number };
} {
  let L = createDocument('BaselineDelete', true);
  L = addNode(
    L,
    makeShapeNode(
      'x',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
      { transform: [1, 0, 0, 1, 0, 0] as const },
    ),
  );
  const x = L.nodes.x!;
  const A: Document = {
    ...L,
    nodes: { ...L.nodes, x: { ...x, transform: [1, 0, 0, 1, -400, 300] as const } },
  };
  const B: Document = {
    ...A,
    nodes: Object.fromEntries(
      Object.entries(A.nodes).filter(([id]) => id !== 'x'),
    ) as Document['nodes'],
    rootChildren: A.rootChildren.filter((id) => id !== 'x'),
  };
  return { L, A, B, aBounds: { x: -400, y: 300, w: 40, h: 40 } };
}

/** A node is added in A, painted at an intermediate position, moved in B. */
function addDuringInteractionDocs(): {
  L: Document;
  A: Document;
  B: Document;
  aBounds: { x: number; y: number; w: number; h: number };
} {
  const L = createDocument('BaselineAdd', true);
  let A = L;
  A = addNode(
    A,
    makeShapeNode(
      'x',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
      { transform: [1, 0, 0, 1, -400, 300] as const },
    ),
  );
  const x = A.nodes.x!;
  const B: Document = {
    ...A,
    nodes: { ...A.nodes, x: { ...x, transform: [1, 0, 0, 1, 400, 300] as const } },
  };
  return { L, A, B, aBounds: { x: -400, y: 300, w: 40, h: 40 } };
}

describe('partial redraw dirty-diff baseline', () => {
  it.each([
    ['move with a non-monotonic path', movingDocs()],
    ['deletion during interaction', deleteDuringInteractionDocs()],
    ['addition during interaction', addDuringInteractionDocs()],
  ])(
    '%s: diffing against the overtaken frame paints over every intermediate pixel',
    (_name, docs) => {
      const { L, A, B, aBounds } = docs;

      // The paint path's buggy baseline (the last COMPLETED doc) misses the
      // intermediate position the overtaken frame painted: the region diffed
      // against L covers L-bounds and B-bounds only.
      const buggyDirty = computeDocumentDirtyRegion(L, B);
      expect(buggyDirty.kind).toBe('partial');
      if (buggyDirty.kind === 'partial') {
        expect(rectsContain(buggyDirty.bounds, aBounds)).toBe(false);
      }

      // The painted-doc baseline covers the intermediate position.
      const fixedDirty = computeDocumentDirtyRegion(A, B);
      expect(fixedDirty.kind).toBe('partial');
      if (fixedDirty.kind === 'partial') {
        expect(rectsContain(fixedDirty.bounds, aBounds)).toBe(true);
      }

      // Reference: a clean full render of B.
      const full = new Map<string, string>();
      renderFull(full, B);

      // Buggy rule: surface = L ⊕ partial(L→A) ⊕ partial(L→B) — the ghost
      // survives at the intermediate position.
      const buggySurface = new Map<string, string>();
      renderFull(buggySurface, L);
      applyPartial(buggySurface, A, computeDocumentDirtyRegion(L, A));
      applyPartial(buggySurface, B, buggyDirty);
      const buggyGhosts = differingCells(buggySurface, full);
      expect(buggyGhosts.length).toBeGreaterThan(0);
      // The ghost is exactly the intermediate painted position, and it is a
      // full silhouette: every cell of the node's painted footprint differs.
      for (const cell of rectCells(aBounds.x, aBounds.y, aBounds.w, aBounds.h)) {
        expect(buggyGhosts).toContain(cell);
      }
      expect(
        buggyGhosts.every((cell) =>
          rectCells(aBounds.x, aBounds.y, aBounds.w, aBounds.h).includes(cell),
        ),
      ).toBe(true);

      // Fixed rule: surface = L ⊕ partial(L→A) ⊕ partial(A→B) ≡ full(B).
      const fixedSurface = new Map<string, string>();
      renderFull(fixedSurface, L);
      applyPartial(fixedSurface, A, computeDocumentDirtyRegion(L, A));
      applyPartial(fixedSurface, B, computeDocumentDirtyRegion(A, B));
      expect(differingCells(fixedSurface, full)).toEqual([]);
    },
  );

  it('intermediate position overlapping an unchanged sibling: the sibling repaints through the damage', () => {
    // bg is a static background node; the moving node's intermediate painted
    // position (-400,300) sits INSIDE it. The fixed baseline must clear the
    // intermediate position and repaint the sibling there, so no ghost
    // covers the sibling's pixels.
    let L = createDocument('BaselineOverlap', true);
    L = addNode(
      L,
      makeShapeNode(
        'bg',
        { kind: 'rect', x: -420, y: 280, w: 200, h: 200 },
        { transform: [1, 0, 0, 1, 0, 0] as const },
      ),
    );
    L = addNode(
      L,
      makeShapeNode(
        'x',
        { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
        { transform: [1, 0, 0, 1, 0, 0] as const },
      ),
    );
    const x = L.nodes.x!;
    const A: Document = {
      ...L,
      nodes: { ...L.nodes, x: { ...x, transform: [1, 0, 0, 1, -400, 300] as const } },
    };
    const B: Document = {
      ...L,
      nodes: { ...L.nodes, x: { ...x, transform: [1, 0, 0, 1, 400, 300] as const } },
    };

    const full = new Map<string, string>();
    renderFull(full, B);

    // Buggy rule leaves the ghost covering the sibling's pixels.
    const buggySurface = new Map<string, string>();
    renderFull(buggySurface, L);
    applyPartial(buggySurface, A, computeDocumentDirtyRegion(L, A));
    applyPartial(buggySurface, B, computeDocumentDirtyRegion(L, B));
    const buggyGhosts = differingCells(buggySurface, full);
    expect(buggyGhosts.length).toBeGreaterThan(0);

    // Fixed rule: exactly equal to the full render of B.
    const fixedSurface = new Map<string, string>();
    renderFull(fixedSurface, L);
    applyPartial(fixedSurface, A, computeDocumentDirtyRegion(L, A));
    applyPartial(fixedSurface, B, computeDocumentDirtyRegion(A, B));
    expect(differingCells(fixedSurface, full)).toEqual([]);
  });

  it('an overtaken full-redraw frame still advances the baseline (structural docs)', () => {
    // Structural change mid-flight: frame paints A via FULL redraw (container
    // change), then B arrives. The baseline must still advance to A.
    let L = createDocument('BaselineStructural', true);
    L = addNode(L, makeShapeNode('x', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }));
    // A: a container change (forces full redraw of A).
    const A: Document = {
      ...L,
      nodes: {
        ...L.nodes,
        g: makeGroupNode('g', { children: ['x'] }),
      },
      rootChildren: ['g'],
    };
    // B: the group moves.
    const B: Document = {
      ...A,
      nodes: { ...A.nodes, g: { ...A.nodes.g!, transform: [1, 0, 0, 1, 300, 0] as const } },
    };
    expect(computeDocumentDirtyRegion(L, A).kind).toBe('full');
    expect(computeDocumentDirtyRegion(A, B).kind).toBe('full');

    const full = new Map<string, string>();
    renderFull(full, B);

    const surface = new Map<string, string>();
    renderFull(surface, L);
    // Frame painting A is a full redraw: the surface is A everywhere.
    applyPartial(surface, A, { kind: 'full' });
    applyPartial(surface, B, computeDocumentDirtyRegion(A, B));
    expect(differingCells(surface, full)).toEqual([]);
  });
});

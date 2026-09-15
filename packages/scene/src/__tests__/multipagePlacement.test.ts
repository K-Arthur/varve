/**
 * Property-based tests for the pasteboard placement engine (ADR-0124).
 *
 * Invariants under test (spec §38.2):
 * - Moving a page preserves page-local node coordinates (content transforms
 *   never change).
 * - Page reorder does not modify page-local content transforms.
 * - Auto placement is deterministic (pure function of pages + facing config).
 * - Auto layout never overlaps pages within a spread.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { addPage, createDocument, reorderPages, setPagePlacement } from '../document';
import {
  autoPageLayout,
  pageBoundsInWorld,
  pasteboardBounds,
  projectSpreads,
  resolvePagePlacement,
  spreadBoundsInWorld,
} from '../pasteboardLayout';
import type { NodeId, Spread } from '../types';

const pointArbitrary = fc.tuple(
  fc.float({ min: -100000, max: 100000, noNaN: true }),
  fc.float({ min: -100000, max: 100000, noNaN: true }),
);

function docWithPages(count: number, opts?: { facing?: boolean; manual?: boolean }): Document {
  let doc = createDocument('prop', false);
  for (let i = 1; i < count; i++) {
    doc = addPage(doc, { width: 400 + i * 50, height: 300 + i * 25 });
  }
  if (opts?.facing) {
    doc = { ...doc, facingPages: { enabled: true, startOnRight: true } };
  }
  if (opts?.manual && doc.pages) {
    doc = {
      ...doc,
      pages: doc.pages.map((p, i) => ({ ...p, placement: { x: i * 700, y: i * 500 } })),
    };
  }
  return doc;
}

function spreadsFromProjection(doc: Document): Spread[] {
  return projectSpreads(doc).map((slots, i) => {
    const ids = slots.map((s) => s.pageId) as [NodeId, ...NodeId[]];
    return { id: `spread-${i}`, pageIds: ids as [NodeId] | [NodeId, NodeId] };
  });
}

describe('Placement preserves content (property-based)', () => {
  it('moving a page never mutates page-local node transforms', () => {
    fc.assert(
      fc.property(pointArbitrary, (newPlacement) => {
        const doc = docWithPages(3);
        const page = doc.pages![1]!;
        const transformBefore = JSON.stringify(doc.nodes[page.contentRoot]!.transform);

        const moved = {
          ...doc,
          pages: doc.pages!.map((p) =>
            p.id === page.id ? { ...p, placement: { x: newPlacement[0], y: newPlacement[1] } } : p,
          ),
        };
        expect(JSON.stringify(moved.nodes[page.contentRoot]!.transform)).toBe(transformBefore);
        const bounds = pageBoundsInWorld(moved, page.id)!;
        expect(bounds.x).toBeCloseTo(newPlacement[0], 6);
        expect(bounds.y).toBeCloseTo(newPlacement[1], 6);
      }),
      { numRuns: 100 },
    );
  });

  it('reordering pages never changes content transforms or placements', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 4 }), { minLength: 5, maxLength: 5 }),
        (perm) => {
          const doc = docWithPages(5, { manual: true });
          const transforms = doc.pages!.map((p) =>
            JSON.stringify(doc.nodes[p.contentRoot]!.transform),
          );
          const placements = doc.pages!.map((p) => JSON.stringify(p.placement));
          const reordered = reorderPages(
            doc,
            perm.map((i) => doc.pages![i]!.id),
          );

          for (const page of reordered.pages!) {
            const idx = doc.pages!.findIndex((p) => p.id === page.id);
            expect(JSON.stringify(reordered.nodes[page.contentRoot]!.transform)).toBe(
              transforms[idx],
            );
            expect(JSON.stringify(page.placement)).toBe(placements[idx]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Deterministic auto layout (property-based)', () => {
  it('autoPageLayout is a pure function of the page set and facing config', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.boolean(), (count, facing) => {
        const a = docWithPages(count, { facing });
        const b = docWithPages(count, { facing });
        const layoutA = autoPageLayout(a);
        const layoutB = autoPageLayout(b);

        // Page ids differ between documents; determinism means the position
        // of page N depends only on page sizes, count, and facing config.
        const positionsA = a.pages!.map((p) => layoutA.get(p.id));
        const positionsB = b.pages!.map((p) => layoutB.get(p.id));
        expect(positionsA).toEqual(positionsB);
      }),
      { numRuns: 50 },
    );
  });

  it('auto layout covers every page and never overlaps pages within a spread', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (count) => {
        const doc = docWithPages(count, { facing: true });
        const layout = autoPageLayout(doc);
        expect(layout.size).toBe(doc.pages!.length);

        const spreads = projectSpreads(doc);
        for (const spread of spreads) {
          const rects = spread.map((slot) => {
            const p = layout.get(slot.pageId)!;
            return { x: p.x, y: p.y, w: slot.width, h: slot.height };
          });
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i]!;
              const b = rects[j]!;
              const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
              const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
              expect(overlapX && overlapY).toBe(false);
            }
          }
        }
      }),
      { numRuns: 50 },
    );
  });

  it('manual placement overrides auto layout', () => {
    const doc = docWithPages(3, { manual: true });
    for (const [i, page] of doc.pages!.entries()) {
      const resolved = resolvePagePlacement(doc, page.id)!;
      expect(resolved.x).toBeCloseTo(i * 700, 6);
      expect(resolved.y).toBeCloseTo(i * 500, 6);
    }
  });
});

describe('Bounds helpers', () => {
  it('pageBoundsInWorld reflects manual placement and mixed sizes', () => {
    const doc = docWithPages(3, { manual: true });
    const page = doc.pages![1]!;
    const bounds = pageBoundsInWorld(doc, page.id)!;
    expect(bounds).toEqual({
      x: page.placement!.x,
      y: page.placement!.y,
      w: page.width,
      h: page.height,
    });
  });

  it('spreadBoundsInWorld is the union of member page bounds', () => {
    let doc = docWithPages(4, { facing: true });
    doc = {
      ...doc,
      spreads: spreadsFromProjection(doc),
    };
    const spread = doc.spreads![1]!;
    const spreadBounds = spreadBoundsInWorld(doc, spread.id)!;
    const pageBounds = spread.pageIds.map((pid) => pageBoundsInWorld(doc, pid)!);
    expect(spreadBounds.x).toBe(Math.min(...pageBounds.map((b) => b.x)));
    expect(spreadBounds.y).toBe(Math.min(...pageBounds.map((b) => b.y)));
    expect(spreadBounds.w).toBe(Math.max(...pageBounds.map((b) => b.x + b.w)) - spreadBounds.x);
    expect(spreadBounds.h).toBe(Math.max(...pageBounds.map((b) => b.y + b.h)) - spreadBounds.y);
  });

  it('pasteboardBounds spans every placed page', () => {
    const doc = docWithPages(4, { manual: true });
    const bounds = pasteboardBounds(doc)!;
    const pages = doc.pages!;
    expect(bounds.x).toBe(Math.min(...pages.map((p) => p.placement!.x)));
    expect(bounds.y).toBe(Math.min(...pages.map((p) => p.placement!.y)));
    const maxX = Math.max(...pages.map((p) => p.placement!.x + p.width));
    const maxY = Math.max(...pages.map((p) => p.placement!.y + p.height));
    expect(bounds.w).toBe(maxX - bounds.x);
    expect(bounds.h).toBe(maxY - bounds.y);
  });
});

describe('setPagePlacement', () => {
  it('updates only the page placement, never content', () => {
    let doc = docWithPages(2);
    const page = doc.pages![0]!;
    const transformBefore = JSON.stringify(doc.nodes[page.contentRoot]!.transform);
    doc = setPagePlacement(doc, page.id, { x: 42, y: -17 });
    expect(doc.pages![0]!.placement).toEqual({ x: 42, y: -17 });
    expect(JSON.stringify(doc.nodes[page.contentRoot]!.transform)).toBe(transformBefore);
  });

  it('no-ops for unknown pages', () => {
    const doc = docWithPages(2);
    const result = setPagePlacement(doc, 'missing', { x: 1, y: 1 });
    expect(result).toBe(doc);
  });

  it('rejects non-finite and out-of-bounds coordinates', () => {
    let doc = docWithPages(2);
    const page = doc.pages![0]!;
    doc = setPagePlacement(doc, page.id, { x: Number.NaN, y: 0 });
    expect(doc.pages![0]!.placement).toBeUndefined();
    doc = setPagePlacement(doc, page.id, { x: 2e7, y: 0 });
    expect(doc.pages![0]!.placement).toBeUndefined();
    doc = setPagePlacement(doc, page.id, { x: 0, y: -2e7 });
    expect(doc.pages![0]!.placement).toBeUndefined();
  });
});

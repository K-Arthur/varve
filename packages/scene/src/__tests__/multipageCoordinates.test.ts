/**
 * Property-based tests for the page/spread coordinate spaces (ADR-0123).
 *
 * Invariants under test (spec §38.2):
 * - pageToWorld(worldToPage(p)) === p and the inverse round-trip.
 * - Spread round-trips hold for every spread.
 * - Cross-page conversion preserves world position.
 *
 * NOTE: this suite imports the coordinate service, which transitively loads
 * @varve/engine. It is runnable once the engine module graph is green
 * (tracked WIP); the placement-only invariants live in
 * multipagePlacement.test.ts which has no engine dependency.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pageToWorld, spreadToWorld, worldToPage, worldToSpread } from '../coordinateService';
import type { Document } from '../document';
import { addPage, createDocument } from '../document';
import { projectSpreads } from '../pasteboardLayout';
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

describe('Coordinate space round-trips (property-based)', () => {
  it('pageToWorld(worldToPage(p)) equals p for every page and point', () => {
    fc.assert(
      fc.property(pointArbitrary, fc.integer({ min: 0, max: 3 }), (point, pageIdx) => {
        const doc = docWithPages(4, { manual: true });
        const page = doc.pages![pageIdx]!;
        const world = pageToWorld(doc, page.id, point)!;
        const back = worldToPage(doc, page.id, world)!;
        expect(back[0]).toBeCloseTo(point[0], 6);
        expect(back[1]).toBeCloseTo(point[1], 6);
      }),
      { numRuns: 200 },
    );
  });

  it('worldToPage(pageToWorld(p)) equals p (inverse)', () => {
    fc.assert(
      fc.property(pointArbitrary, fc.integer({ min: 0, max: 3 }), (point, pageIdx) => {
        const doc = docWithPages(4, { manual: true });
        const page = doc.pages![pageIdx]!;
        const local = worldToPage(doc, page.id, point)!;
        const world = pageToWorld(doc, page.id, local)!;
        expect(world[0]).toBeCloseTo(point[0], 6);
        expect(world[1]).toBeCloseTo(point[1], 6);
      }),
      { numRuns: 200 },
    );
  });

  it('round-trips hold with auto placement and negative coordinates', () => {
    fc.assert(
      fc.property(pointArbitrary, fc.integer({ min: 0, max: 3 }), (point, pageIdx) => {
        const doc = docWithPages(4, { facing: true });
        const page = doc.pages![pageIdx]!;
        const world = pageToWorld(doc, page.id, point)!;
        expect(worldToPage(doc, page.id, world)).toEqual([
          expect.closeTo(point[0], 6),
          expect.closeTo(point[1], 6),
        ]);
      }),
      { numRuns: 200 },
    );
  });

  it('spread round-trips hold for every spread', () => {
    fc.assert(
      fc.property(pointArbitrary, fc.integer({ min: 0, max: 2 }), (point, spreadIdx) => {
        let doc = createDocument('prop', false);
        for (let i = 1; i < 4; i++) doc = addPage(doc);
        doc = { ...doc, facingPages: { enabled: true, startOnRight: true } };
        doc = { ...doc, spreads: spreadsFromProjection(doc) };
        const spread = doc.spreads![spreadIdx % doc.spreads!.length]!;
        const world = spreadToWorld(doc, spread.id, point)!;
        const back = worldToSpread(doc, spread.id, world)!;
        expect(back[0]).toBeCloseTo(point[0], 6);
        expect(back[1]).toBeCloseTo(point[1], 6);
      }),
      { numRuns: 200 },
    );
  });

  it('single-page spread fallback treats unknown spread ids as page ids', () => {
    fc.assert(
      fc.property(pointArbitrary, (point) => {
        const doc = docWithPages(2, { manual: true });
        const page = doc.pages![0]!;
        const world = spreadToWorld(doc, page.id, point)!;
        const back = worldToSpread(doc, page.id, world)!;
        expect(back[0]).toBeCloseTo(point[0], 6);
        expect(back[1]).toBeCloseTo(point[1], 6);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Cross-page conversion preserves world position', () => {
  it('reparenting a node between pages via page-local conversion keeps world position', () => {
    const doc = docWithPages(2, { manual: true });
    const [p0, p1] = doc.pages!;
    if (!p0 || !p1) throw new Error('expected two pages');

    // A node at page-local (10, 20) on page 0 has a world position.
    const worldOfNode = pageToWorld(doc, p0.id, [10, 20])!;
    // Same world point expressed in page 1 local coordinates:
    const localOnP1 = worldToPage(doc, p1.id, worldOfNode)!;
    expect(localOnP1[0]).toBeCloseTo(10 + (p0.placement!.x - p1.placement!.x), 6);
    expect(localOnP1[1]).toBeCloseTo(20 + (p0.placement!.y - p1.placement!.y), 6);

    // Round trip back to world through page 1:
    const worldAgain = pageToWorld(doc, p1.id, localOnP1)!;
    expect(worldAgain[0]).toBeCloseTo(worldOfNode[0], 6);
    expect(worldAgain[1]).toBeCloseTo(worldOfNode[1], 6);
  });
});

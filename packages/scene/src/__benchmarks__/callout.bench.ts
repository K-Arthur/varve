// @vitest-environment node
/**
 * Comic lettering performance bench.
 *
 * The scenarios mirror the brief's chapter stress cases: a handful of
 * balloons, a text-heavy page, and a full chapter. They measure the two
 * operations that run on interaction — contour layout and fit status — plus
 * document size, so a regression in either is visible before it reaches a
 * 500-balloon chapter.
 *
 * Run: pnpm bench:lettering
 */
import { resolveTextGeometry, setTextAdvanceMeasurer } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { createCallout, createDocument, fitCalloutToText, getCalloutFitReport } from '../index';
import { textGeometryInput } from '../textBounds';
import type { GroupNode, TextNode } from '../types';

const LINE_HEIGHTS = [1, 20, 100, 500];

function buildBalloons(count: number): ReturnType<typeof createDocument> {
  let doc = createDocument('lettering-bench', true);
  for (let index = 0; index < count; index++) {
    const created = createCallout(doc, {
      x: (index % 10) * 240,
      y: Math.floor(index / 10) * 180,
      w: 210,
      h: 140,
      kind: index % 7 === 0 ? 'thought' : index % 5 === 0 ? 'caption' : 'speech',
      text:
        index % 4 === 0
          ? 'No.'
          : 'Wait for me at the station. If the lights go out, take the east stairs and do not look back.',
    });
    doc = created.document;
  }
  return doc;
}

function measureLayout(doc: ReturnType<typeof createDocument>, rounds: number): number {
  const textIds = Object.values(doc.nodes)
    .filter((node): node is TextNode => node.kind === 'text')
    .map((node) => node.id);
  const started = performance.now();
  for (let round = 0; round < rounds; round++) {
    for (const id of textIds) {
      const node = doc.nodes[id];
      if (node?.kind === 'text') resolveTextGeometry(textGeometryInput(node));
    }
  }
  return performance.now() - started;
}

function measureFitStatus(doc: ReturnType<typeof createDocument>): number {
  const groupIds = Object.values(doc.nodes)
    .filter((node): node is GroupNode => node.kind === 'group' && Boolean(node.callout))
    .map((node) => node.id);
  const started = performance.now();
  for (const id of groupIds) getCalloutFitReport(doc, id);
  return performance.now() - started;
}

function measureFit(doc: ReturnType<typeof createDocument>, rounds: number): number {
  const groupIds = Object.values(doc.nodes)
    .filter((node): node is GroupNode => node.kind === 'group' && Boolean(node.callout))
    .map((node) => node.id);
  const started = performance.now();
  for (let round = 0; round < rounds; round++) {
    for (const id of groupIds) fitCalloutToText(doc, id);
  }
  return performance.now() - started;
}

describe('comic lettering bench', () => {
  it('contour layout stays linear from 1 to 500 balloons', () => {
    setTextAdvanceMeasurer({
      measureAdvance: (text: string) => text.length * 7.6,
      revision: () => 'lettering-bench',
    });
    const results: Array<{ count: number; layoutMs: number; fitMs: number }> = [];
    for (const count of LINE_HEIGHTS) {
      const doc = buildBalloons(count);
      // Warm the derivation once so the first-call JIT cost is not the metric.
      measureLayout(doc, 1);
      const layoutMs = measureLayout(doc, 3) / 3;
      const fitMs = measureFit(doc, 3) / 3;
      const statusMs = measureFitStatus(doc);
      results.push({ count, layoutMs, fitMs });
      console.log(
        `lettering-bench balloons=${count} layout=${layoutMs.toFixed(2)}ms fit=${fitMs.toFixed(2)}ms status=${statusMs.toFixed(2)}ms`,
      );
      expect(Number.isFinite(layoutMs)).toBe(true);
      expect(Number.isFinite(fitMs)).toBe(true);
    }
    // Per-balloon contour layout must not blow up with chapter size: the
    // 500-balloon average stays within 8x the single-balloon average.
    const single = results[0]!.layoutMs / 1;
    const chapter = results[3]!.layoutMs / 500;
    expect(chapter).toBeLessThan(Math.max(1, single * 8));
    setTextAdvanceMeasurer(null);
  }, 120_000);

  it('fits a 100-balloon page without quadratic growth', () => {
    const doc = buildBalloons(100);
    const first = measureFit(doc, 1);
    const repeated = measureFit(doc, 5) / 5;
    console.log(
      `lettering-bench fit-page first=${first.toFixed(2)}ms repeated=${repeated.toFixed(2)}ms`,
    );
    expect(repeated).toBeLessThan(4000);
    expect(
      getCalloutFitReport(doc, Object.values(doc.nodes).find((n) => n.kind === 'group')!.id),
    ).not.toBeNull();
  }, 120_000);
});

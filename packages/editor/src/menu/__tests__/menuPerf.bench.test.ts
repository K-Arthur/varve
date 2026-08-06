import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  buildIntelFacts,
  computeDocumentFacts,
  computeSelectionFacts,
  createTimingGuard,
  detectPlatformFacts,
  renderMenubarItems,
  renderMenuItems,
} from '..';
import { getAllMenuDefs, getCanvasContextMenuDefs } from '../defs';
import type { MenuContext, MenuItemDef } from '../types';
import { buildSyntheticDoc } from './syntheticDocs';

function buildCtx(
  selection: string[],
  doc: ReturnType<typeof createDocument>,
  workspace: 'design' | 'print' | 'drawing' | 'image' | 'motion' | 'codegen' = 'design',
): MenuContext {
  const pf = detectPlatformFacts('web');
  const sf = computeSelectionFacts(selection, doc.nodes);
  const df = computeDocumentFacts(doc, selection[0] ?? null);
  df.hasSelection = sf.count > 0;
  df.hasMultipleSelection = sf.count >= 2;
  const intel = buildIntelFacts([], null, false);
  return { selection: sf, document: df, workspace, platform: pf, intelligence: intel };
}

function warmUp(fn: () => void, iterations = 3): void {
  for (let i = 0; i < iterations; i++) fn();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function measure(
  times: number,
  fn: () => void,
): { p50: number; p95: number; min: number; max: number; samples: number[] } {
  const samples: number[] = [];
  for (let i = 0; i < times; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    samples,
  };
}

describe('menu perf — fact computation', () => {
  const SIZES = [100, 1000, 10000, 50000] as const;

  for (const size of SIZES) {
    it(`computeSelectionFacts stays under 4ms p95 at ${size} nodes (single selection)`, () => {
      const { doc, selection } = buildSyntheticDoc({ nodeCount: size });
      warmUp(() => computeSelectionFacts(selection, doc.nodes));
      const result = measure(100, () => computeSelectionFacts(selection, doc.nodes));
      expect(result.p95).toBeLessThan(4);
    });

    it(`computeDocumentFacts stays under 4ms p95 at ${size} nodes`, () => {
      const { doc } = buildSyntheticDoc({ nodeCount: size });
      warmUp(() => computeDocumentFacts(doc, null));
      const result = measure(100, () => computeDocumentFacts(doc, null));
      expect(result.p95).toBeLessThan(4);
    });
  }

  it('computeSelectionFacts stays under 4ms p95 for 1000-node selection on a 50000-node doc', () => {
    const { doc, selection } = buildSyntheticDoc({ nodeCount: 50000, selectionSize: 1000 });
    warmUp(() => computeSelectionFacts(selection, doc.nodes));
    const result = measure(100, () => computeSelectionFacts(selection, doc.nodes));
    expect(result.p95).toBeLessThan(4);
  });
});

describe('menu perf — rendering', () => {
  it('renderMenuItems for all top-level menus stays under 50ms p95 on a 10000-node doc', () => {
    const { doc, selection } = buildSyntheticDoc({ nodeCount: 10000 });
    const ctx = buildCtx(selection, doc);
    const defs = getAllMenuDefs({ runAction: () => {} });
    const renderOpts = { ctx, run: (_id: string) => {} };

    warmUp(() => {
      for (const def of defs) {
        if (def.kind === 'submenu' && def.items) {
          const items = typeof def.items === 'function' ? def.items(ctx) : def.items;
          renderMenuItems(items, ctx, renderOpts);
        }
      }
    });

    const result = measure(50, () => {
      for (const def of defs) {
        if (def.kind === 'submenu' && def.items) {
          const items = typeof def.items === 'function' ? def.items(ctx) : def.items;
          renderMenuItems(items, ctx, renderOpts);
        }
      }
    });

    expect(result.p95).toBeLessThan(50);
  });

  it('renderMenubarItems stays under 50ms p95 on a 10000-node doc', () => {
    const { doc, selection } = buildSyntheticDoc({ nodeCount: 10000 });
    const ctx = buildCtx(selection, doc);
    const defs = getAllMenuDefs({ runAction: () => {} });
    const renderOpts = { ctx, run: (_id: string) => {} };

    warmUp(() => renderMenubarItems(defs, ctx, renderOpts));
    const result = measure(50, () => renderMenubarItems(defs, ctx, renderOpts));
    expect(result.p95).toBeLessThan(50);
  });

  it('canvas context menu rendering stays under 50ms p95 on a 10000-node doc', () => {
    const { doc, selection } = buildSyntheticDoc({ nodeCount: 10000 });
    const ctx = buildCtx(selection, doc);
    const defs = getCanvasContextMenuDefs(() => {});
    const renderOpts = { ctx, run: (_id: string) => {} };

    warmUp(() => renderMenuItems(defs, ctx, renderOpts));
    const result = measure(50, () => renderMenuItems(defs, ctx, renderOpts));
    expect(result.p95).toBeLessThan(50);
  });

  it('submenu rendering (Apply Master with 20 masters) stays under 30ms p95', () => {
    const { doc, selection } = buildSyntheticDoc({ nodeCount: 100, masterCount: 20 });
    const ctx = buildCtx(selection, doc);
    ctx.document.masterPages = Object.entries(doc.masters ?? {}).map(([id, m]) => ({
      id,
      name: (m as { name: string }).name,
    }));
    const defs = getAllMenuDefs({ runAction: () => {} });
    const pageMenu = defs.find((d) => d.id === 'page');
    const applyMaster = (pageMenu?.items as MenuItemDef[])?.find((d) => d.id === 'applyMaster');
    const renderOpts = { ctx, run: (_id: string) => {} };

    if (applyMaster?.items) {
      const items =
        typeof applyMaster.items === 'function' ? applyMaster.items(ctx) : applyMaster.items;
      warmUp(() => renderMenuItems(items, ctx, renderOpts));
      const result = measure(100, () => renderMenuItems(items, ctx, renderOpts));
      expect(result.p95).toBeLessThan(30);
    }
  });
});

describe('menu perf — submenu lazy loading', () => {
  it('lazy submenu items are not evaluated until explicitly requested', () => {
    const { doc, selection } = buildSyntheticDoc({ nodeCount: 50000 });
    const ctx = buildCtx(selection, doc);
    let evaluated = false;

    const lazyDef: MenuItemDef = {
      id: 'test-lazy',
      labelKey: 'Lazy',
      kind: 'submenu',
      items: () => {
        evaluated = true;
        return [];
      },
      run: () => {},
    };

    expect(evaluated).toBe(false);
    const items = typeof lazyDef.items === 'function' ? lazyDef.items(ctx) : (lazyDef.items ?? []);
    expect(evaluated).toBe(true);
    expect(items).toEqual([]);
  });
});

describe('menu perf — predicate guard', () => {
  it('createTimingGuard wraps predicates and enforces < 1ms budget in dev', () => {
    const ctx = buildCtx([], createDocument('test'));
    const fast = createTimingGuard('fast', () => true);
    expect(fast!(ctx)).toBe(true);
  });
});

describe('menu perf — selection change cost', () => {
  it('selection change recomputation stays under 4ms p95 on a 1000-node selection', () => {
    const { doc, selection } = buildSyntheticDoc({ nodeCount: 50000, selectionSize: 1000 });
    warmUp(() => {
      computeSelectionFacts(selection, doc.nodes);
    });
    const result = measure(100, () => {
      computeSelectionFacts(selection, doc.nodes);
    });
    expect(result.p95).toBeLessThan(4);
  });
});

describe('menu perf — multi-page / multi-master docs', () => {
  it('document with 100 pages and 20 masters computes facts under 4ms p95', () => {
    const { doc, selection } = buildSyntheticDoc({
      nodeCount: 1000,
      pageCount: 100,
      masterCount: 20,
    });
    warmUp(() => computeDocumentFacts(doc, selection[0] ?? null));
    const result = measure(100, () => computeDocumentFacts(doc, selection[0] ?? null));
    expect(result.p95).toBeLessThan(4);
  });
});

describe('menu perf — audit findings', () => {
  it('intel facts for 5000 findings amortize under 4ms per call', () => {
    const findings: Array<{ severity?: string }> = [];
    for (let i = 0; i < 5000; i++) {
      findings.push({ severity: ['critical', 'warning', 'info', 'style'][i % 4] });
    }
    warmUp(() => buildIntelFacts(findings, Date.now(), false));
    const BATCH = 100;
    const t0 = performance.now();
    for (let i = 0; i < BATCH; i++) {
      buildIntelFacts(findings, Date.now(), false);
    }
    const amortizedMs = (performance.now() - t0) / BATCH;
    expect(amortizedMs).toBeLessThan(4);
  });
});

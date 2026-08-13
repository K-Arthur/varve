import { describe, expect, it } from 'vitest';
import { uniformBleed } from '../colorManagement';
import { createDocument, makeShapeNode } from '../document';
import { createExportConfiguration, type ExportBatchRequest } from './model';
import {
  buildExportPlan,
  computeScaleFactor,
  type PlanContext,
  resolveBoundsRect,
  resolveDimensions,
  resolveTarget,
} from './plan';

function docWithShapes() {
  const rect = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Card' });
  const doc = createDocument('Doc', true);
  return {
    ...doc,
    rootChildren: ['n1'],
    nodes: { ...doc.nodes, n1: rect },
  } as ReturnType<typeof createDocument> & {
    rootChildren: string[];
    nodes: Record<string, typeof rect>;
  };
}

function batchRequest(configurations: ExportBatchRequest['configurations']): ExportBatchRequest {
  return {
    id: 'batch-1',
    configurations,
    conflictPolicy: 'rename',
    failurePolicy: 'continue',
    createdAt: 0,
    createdBy: 'test',
  };
}

describe('resolveTarget', () => {
  it('resolves node targets to a single node', () => {
    const doc = docWithShapes();
    const target = resolveTarget(doc, { type: 'node', nodeId: 'n1' }, { document: doc });
    expect(target).toMatchObject({ kind: 'node', nodeIds: ['n1'], name: 'Card' });
  });

  it('resolves missing nodes to an empty target (not an error throw)', () => {
    const doc = docWithShapes();
    const target = resolveTarget(doc, { type: 'node', nodeId: 'missing' }, { document: doc });
    expect(target.nodeIds).toEqual([]);
  });

  it('resolves selection from context when unspecified', () => {
    const doc = docWithShapes();
    const target = resolveTarget(
      doc,
      { type: 'selection' },
      { document: doc, selectionIds: ['n1'] },
    );
    expect(target.nodeIds).toEqual(['n1']);
  });

  it('resolves document targets from root children', () => {
    const doc = docWithShapes();
    const target = resolveTarget(doc, { type: 'document' }, { document: doc });
    expect(target.nodeIds).toEqual(['n1']);
  });

  it('resolves page targets to backgrounds + contentRoot', () => {
    const doc = createDocument('Doc');
    const page = doc.pages?.[0];
    expect(page).toBeDefined();
    const target = resolveTarget(
      doc,
      { type: 'page', pageId: page?.id ?? 'p1' },
      { document: doc },
    );
    expect(target.kind).toBe('page');
    expect(target.nodeIds).toContain(page?.contentRoot);
  });
});

describe('resolveBoundsRect', () => {
  it('uses nominal bounds for the object policy', () => {
    const doc = docWithShapes();
    const target = resolveTarget(doc, { type: 'node', nodeId: 'n1' }, { document: doc });
    const bounds = resolveBoundsRect(doc, target, 'object', { document: doc });
    expect(bounds).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('expands bounds for the visual policy when effects overflow', () => {
    const rect = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      {
        name: 'Card',
        effects: [
          {
            type: 'dropShadow',
            x: 5,
            y: 5,
            blur: 10,
            spread: 2,
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
      },
    );
    const doc = {
      ...createDocument('Doc', true),
      rootChildren: ['n1'],
      nodes: { n1: rect },
    } as ReturnType<typeof createDocument> & {
      rootChildren: string[];
      nodes: Record<string, typeof rect>;
    };

    const target = resolveTarget(doc, { type: 'node', nodeId: 'n1' }, { document: doc });
    const object = resolveBoundsRect(doc, target, 'object', { document: doc });
    const visual = resolveBoundsRect(doc, target, 'visual', { document: doc });
    expect(object).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    // shadow pad: blur(10) + spread(2) + max(0, -5) = 17 each side, plus +5 y offset
    expect(visual?.width).toBeGreaterThan(200);
    expect(visual?.height).toBeGreaterThan(100);
    expect(visual?.x).toBeLessThan(0);
  });

  it('resolves page and page-bleed bounds from page size + bleed', () => {
    const doc = createDocument('Doc', {
      bleed: uniformBleed(3, 'mm'),
      dpi: 96,
    });
    const page = doc.pages?.[0];
    expect(page).toBeDefined();
    const target = resolveTarget(
      doc,
      { type: 'page', pageId: page?.id ?? 'p1' },
      { document: doc },
    );
    const pageBounds = resolveBoundsRect(doc, target, 'page', { document: doc });
    const bleedBounds = resolveBoundsRect(doc, target, 'page-bleed', {
      document: doc,
      customBounds: undefined,
    });
    expect(pageBounds).toMatchObject({ width: page?.width, height: page?.height });
    expect(bleedBounds ? bleedBounds.width : 0).toBeGreaterThan(pageBounds?.width ?? 0);
    expect(bleedBounds ? bleedBounds.height : 0).toBeGreaterThan(pageBounds?.height ?? 0);
  });

  it('page-bleed expands by the exact canonical per-edge bleed (3mm at 96dpi world scale)', () => {
    const doc = createDocument('Doc', {
      bleed: uniformBleed(3, 'mm'),
      dpi: 300, // print dpi must NOT change the world-px expansion
    });
    const page = doc.pages?.[0];
    const target = resolveTarget(
      doc,
      { type: 'page', pageId: page?.id ?? 'p1' },
      { document: doc },
    );
    const bleedBounds = resolveBoundsRect(doc, target, 'page-bleed', { document: doc });
    const b3 = (3 * 96) / 25.4; // 11.3386 world px per edge
    expect(bleedBounds?.x).toBeCloseTo(-b3, 5);
    expect(bleedBounds?.y).toBeCloseTo(-b3, 5);
    expect(bleedBounds?.width).toBeCloseTo((page?.width ?? 0) + b3 * 2, 5);
    expect(bleedBounds?.height).toBeCloseTo((page?.height ?? 0) + b3 * 2, 5);
  });

  it('unconfigured documents export trim-only (zero bleed)', () => {
    const doc = createDocument('Doc', false); // no bleed configured
    const page = doc.pages?.[0];
    const target = resolveTarget(
      doc,
      { type: 'page', pageId: page?.id ?? 'p1' },
      { document: doc },
    );
    const bleedBounds = resolveBoundsRect(doc, target, 'page-bleed', { document: doc });
    expect(bleedBounds).toEqual({
      x: 0,
      y: 0,
      width: page?.width,
      height: page?.height,
    });
  });
});

describe('computeScaleFactor', () => {
  const doc = { ...createDocument('Doc', true), dpi: 96 } as const;

  it('resolves multiplier, width, and height modes', () => {
    expect(
      computeScaleFactor({ mode: 'multiplier', value: 2 }, { width: 100, height: 50 }, doc),
    ).toBe(2);
    expect(
      computeScaleFactor(
        { mode: 'width', value: 400, unit: 'px' },
        { width: 200, height: 100 },
        doc,
      ),
    ).toBe(2);
    expect(
      computeScaleFactor(
        { mode: 'height', value: 50, unit: 'px' },
        { width: 200, height: 100 },
        doc,
      ),
    ).toBe(0.5);
  });

  it('converts physical units via document DPI', () => {
    expect(
      computeScaleFactor({ mode: 'width', value: 1, unit: 'in' }, { width: 96, height: 96 }, doc),
    ).toBe(1);
    expect(
      computeScaleFactor({ mode: 'width', value: 96, unit: 'mm' }, { width: 96, height: 96 }, doc),
    ).toBeCloseTo((96 / 25.4 / 96) * 96, 5);
  });

  it('resolves resolution mode against document DPI', () => {
    expect(
      computeScaleFactor({ mode: 'resolution', dpi: 300 }, { width: 100, height: 100 }, doc),
    ).toBe(300 / 96);
  });
});

describe('resolveDimensions', () => {
  it('rounds fractional results and never yields zero', () => {
    const dims = resolveDimensions({ x: 0, y: 0, width: 200.6, height: 100.4 }, 0.5, 'png');
    expect(dims).toMatchObject({ width: 100, height: 50, clamped: false });
  });

  it('clamps oversized outputs to the format limit', () => {
    const dims = resolveDimensions({ x: 0, y: 0, width: 10000, height: 10000 }, 2, 'png');
    expect(dims.width).toBeLessThanOrEqual(16_384);
    expect(dims.height).toBeLessThanOrEqual(16_384);
    expect(dims.clamped).toBe(true);
  });

  it('clamps the shorter side proportionally', () => {
    const dims = resolveDimensions({ x: 0, y: 0, width: 10, height: 100000 }, 1, 'png');
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBe(16_384);
  });
});

describe('buildExportPlan', () => {
  it('expands enabled configurations into deterministic job specs', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      scale: { mode: 'multiplier', value: 2 },
      suffix: '@2x',
      raster: { transparency: true },
    });
    const plan = buildExportPlan(doc, batchRequest([config]), { document: doc });

    expect(plan.errors).toEqual([]);
    expect(plan.items).toHaveLength(1);
    const spec = plan.items[0];
    expect(spec).toMatchObject({
      configurationId: 'c1',
      name: 'Card',
      format: 'png',
      fileName: 'Card@2x.png',
      relativePath: 'Card@2x.png',
      scaleFactor: 2,
      resolvedDimensions: { width: 400, height: 200 },
      rasterized: true,
      bounds: 'visual',
    });
    expect(plan.items[0]?.requiresImageManifest).toBe(false);
  });

  it('skips disabled configurations', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      enabled: false,
    });
    const plan = buildExportPlan(doc, batchRequest([config]), { document: doc });
    expect(plan.items).toHaveLength(0);
  });

  it('reports unsupported formats instead of producing specs', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'tiff',
    });
    const plan = buildExportPlan(doc, batchRequest([config]), { document: doc });
    expect(plan.items).toHaveLength(0);
    expect(plan.errors[0]).toMatchObject({ configurationId: 'c1', code: 'format-unsupported' });
  });

  it('reports empty targets', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'missing' },
      format: 'png',
    });
    const plan = buildExportPlan(doc, batchRequest([config]), { document: doc });
    expect(plan.items).toHaveLength(0);
    expect(plan.errors[0]).toMatchObject({ code: 'target-empty' });
  });

  it('supports multiple configurations for one target', () => {
    const doc = docWithShapes();
    const configs = [
      createExportConfiguration({
        id: 'svg',
        target: { type: 'node', nodeId: 'n1' },
        format: 'svg',
        suffix: '-icon',
      }),
      createExportConfiguration({
        id: 'png1x',
        target: { type: 'node', nodeId: 'n1' },
        format: 'png',
        scale: { mode: 'multiplier', value: 1 },
      }),
      createExportConfiguration({
        id: 'png2x',
        target: { type: 'node', nodeId: 'n1' },
        format: 'png',
        scale: { mode: 'multiplier', value: 2 },
      }),
    ];
    const plan = buildExportPlan(doc, batchRequest(configs), { document: doc });
    expect(plan.items.map((i) => i.fileName)).toEqual(['Card-icon.svg', 'Card.png', 'Card.png']);
    expect(plan.items[0]).toMatchObject({ format: 'svg', rasterized: false });
    expect(plan.items[2]).toMatchObject({ resolvedDimensions: { width: 400, height: 200 } });
  });

  it('marks PDF-family specs as requiring an image manifest', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'pdf-x1a',
    });
    const plan = buildExportPlan(doc, batchRequest([config]), { document: doc, platform: 'tauri' });
    expect(plan.items[0]?.requiresImageManifest).toBe(true);
  });

  it('produces deterministic output order', () => {
    const doc = docWithShapes();
    const configs = [1, 2, 3].map((n) =>
      createExportConfiguration({
        id: `c${n}`,
        target: { type: 'node', nodeId: 'n1' },
        format: 'png',
        scale: { mode: 'multiplier', value: n },
        suffix: `@${n}x`,
      }),
    );
    const run = (ctx: PlanContext) =>
      buildExportPlan(doc, batchRequest(configs), ctx).items.map((i) => i.fileName);
    expect(run({ document: doc })).toEqual(run({ document: doc }));
  });
});

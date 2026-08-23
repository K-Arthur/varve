import { describe, expect, it } from 'vitest';
import { createDocument, makeShapeNode } from '../document';
import { createExportConfiguration, type ExportBatchRequest } from './model';
import { runExportPreflight } from './preflight';

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

function request(configurations: ExportBatchRequest['configurations']): ExportBatchRequest {
  return {
    id: 'batch-1',
    configurations,
    conflictPolicy: 'rename',
    failurePolicy: 'continue',
    createdAt: 0,
    createdBy: 'test',
  };
}

function pngConfig(target: ExportBatchRequest['configurations'][number]['target']) {
  return createExportConfiguration({ id: 'c1', target, format: 'png' });
}

describe('runExportPreflight', () => {
  it('reports no findings for a clean PNG export', () => {
    const doc = docWithShapes();
    const result = runExportPreflight(doc, request([pngConfig({ type: 'node', nodeId: 'n1' })]));
    expect(result.blocked).toBe(false);
    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('surfaces plan errors as blocking findings', () => {
    const doc = docWithShapes();
    const result = runExportPreflight(
      doc,
      request([pngConfig({ type: 'node', nodeId: 'missing' })]),
    );
    expect(result.blocked).toBe(true);
    expect(result.errorCount).toBe(1);
    expect(result.findings[0]).toMatchObject({ code: 'target-empty', severity: 'error' });
  });

  it('blocks unsupported formats without a canIgnore escape', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'tiff',
    });
    const result = runExportPreflight(doc, request([config]));
    expect(result.blocked).toBe(true);
    const unsupported = result.findings.find((f) => f.code === 'format-unsupported');
    expect(unsupported).toMatchObject({ severity: 'error', canIgnore: false });
    expect(unsupported?.description).toContain('TIFF');
  });

  it('flags JPEG transparency flattening as informational', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'jpeg',
    });
    const result = runExportPreflight(doc, request([config]));
    const finding = result.findings.find((f) => f.code === 'transparent-background-flattened');
    expect(finding).toMatchObject({ severity: 'info' });
  });

  it('warns about memory-risk outputs above the pixel budget', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      scale: { mode: 'multiplier', value: 1000 },
    });
    const result = runExportPreflight(doc, request([config]), { maxPixels: 100_000 });
    const finding = result.findings.find((f) => f.code === 'memory-risk');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
    expect(finding?.description).toContain('MP');
  });

  it('warns about missing fonts when the font registry is supplied', () => {
    const text = makeShapeNode('t1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, {});
    const doc = {
      ...createDocument('Doc', true),
      rootChildren: ['t1'],
      nodes: {
        t1: {
          ...text,
          kind: 'text' as const,
          fontFamily: 'NotInstalled',
          text: 'Hi',
          fontSize: 16,
        },
      },
    } as ReturnType<typeof createDocument> & { rootChildren: string[] };

    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 't1' },
      format: 'png',
    });
    const result = runExportPreflight(doc, request([config]), {
      availableFonts: new Set(['Inter']),
    });
    const finding = result.findings.find((f) => f.code === 'missing-font');
    expect(finding).toMatchObject({ severity: 'warning' });
    expect(finding?.description).toContain('NotInstalled');
    expect(finding?.fixAction?.type).toBe('outline-text');
  });

  it('skips font checks when no registry is supplied', () => {
    const doc = docWithShapes();
    const result = runExportPreflight(doc, request([pngConfig({ type: 'node', nodeId: 'n1' })]));
    expect(result.findings.some((f) => f.code === 'missing-font')).toBe(false);
  });

  it('detects RGB content in CMYK output and suggests conversion', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'pdf-x1a',
      color: { profile: 'srgb' },
    });
    const result = runExportPreflight(doc, request([config]), { platform: 'tauri' });
    const finding = result.findings.find((f) => f.code === 'rgb-in-cmyk');
    expect(finding).toMatchObject({
      severity: 'warning',
      fixAction: { type: 'convert-color-space', target: 'cmyk' },
    });
  });

  it('warns about CMYK without an output profile', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'pdf-x1a',
      color: { profile: 'cmyk' },
    });
    const result = runExportPreflight(doc, request([config]), { platform: 'tauri' });
    expect(result.findings.some((f) => f.code === 'cmyk-missing-profile')).toBe(true);
  });

  it('warns about crop marks without bleed', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'pdf-x4',
      color: { profile: 'srgb' },
      print: { bleedMm: 0, includeCropMarks: true },
    });
    const result = runExportPreflight(doc, request([config]), { platform: 'tauri' });
    const finding = result.findings.find((f) => f.code === 'missing-bleed');
    expect(finding).toMatchObject({ severity: 'warning' });
    expect(finding?.description).toContain('bleed');
  });

  it('notes subtree rasterization for effects the format cannot preserve', () => {
    const rect = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      {
        name: 'Card',
        effects: [
          {
            type: 'layerBlur',
            radius: 12,
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

    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'svg',
    });
    const result = runExportPreflight(doc, request([config]));
    const finding = result.findings.find((f) => f.code === 'subtree-rasterized');
    expect(finding).toMatchObject({ severity: 'info' });
    expect(finding?.nodeIds).toEqual(['n1']);
  });

  it('detects duplicate output paths as blocking collisions', () => {
    const doc = docWithShapes();
    const configs = [
      createExportConfiguration({
        id: 'a',
        target: { type: 'node', nodeId: 'n1' },
        format: 'png',
        scale: { mode: 'multiplier', value: 1 },
      }),
      createExportConfiguration({
        id: 'b',
        target: { type: 'node', nodeId: 'n1' },
        format: 'png',
        scale: { mode: 'multiplier', value: 1 },
      }),
    ];
    const result = runExportPreflight(doc, request(configs));
    const finding = result.findings.find((f) => f.code === 'path-collision');
    expect(finding).toMatchObject({ severity: 'error', canIgnore: false });
    expect(finding?.description).toContain('Card.png');
  });

  it('reports GIF exports as static single frames', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'gif',
    });
    const result = runExportPreflight(doc, request([config]));
    expect(result.findings.some((f) => f.code === 'gif-static-frame')).toBe(true);
  });

  it('produces deterministic findings across runs', () => {
    const doc = docWithShapes();
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'jpeg',
    });
    const a = runExportPreflight(doc, request([config]));
    const b = runExportPreflight(doc, request([config]));
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id));
  });

  it('warns when a placed image has effective PPI below the enforceDpi target', () => {
    // 400×300 source image placed in a 4000×3000 shape → effective PPI ≈ 9.6.
    const base = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 4000, h: 3000 }, { name: 'Photo' });
    const imgShape = {
      ...base,
      fills: [
        {
          type: 'image' as const,
          image: { src: '', fit: 'fill' as const, x: 0, y: 0, scale: 1, imageWidth: 400, imageHeight: 300 },
        },
      ],
    };
    const doc = {
      ...createDocument('Doc', true),
      rootChildren: ['n1'],
      nodes: { n1: imgShape },
    } as ReturnType<typeof createDocument> & {
      rootChildren: string[];
      nodes: Record<string, typeof imgShape>;
    };

    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      scale: { mode: 'multiplier', value: 1 },
      print: { enforceDpi: 300 },
    });
    const result = runExportPreflight(doc, request([config]));
    const finding = result.findings.find((f) => f.code === 'low-effective-resolution');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
    expect(finding?.nodeIds).toEqual(['n1']);
    expect(finding?.description).toContain('10');
  });

  it('does not warn when effective PPI meets the enforceDpi target', () => {
    // 4000×3000 source in a 200×100 shape → effective PPI = 600.
    const base = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Sharp' });
    const imgShape = {
      ...base,
      fills: [
        {
          type: 'image' as const,
          image: { src: '', fit: 'fill' as const, x: 0, y: 0, scale: 1, imageWidth: 4000, imageHeight: 3000 },
        },
      ],
    };
    const doc = {
      ...createDocument('Doc', true),
      rootChildren: ['n1'],
      nodes: { n1: imgShape },
    } as ReturnType<typeof createDocument> & {
      rootChildren: string[];
      nodes: Record<string, typeof imgShape>;
    };

    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      scale: { mode: 'multiplier', value: 1 },
      print: { enforceDpi: 300 },
    });
    const result = runExportPreflight(doc, request([config]));
    expect(result.findings.some((f) => f.code === 'low-effective-resolution')).toBe(false);
  });

  it('does not warn for tile fills which have no whole-object PPI', () => {
    const base = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 4000, h: 3000 }, { name: 'Tile' });
    const imgShape = {
      ...base,
      fills: [
        {
          type: 'image' as const,
          image: { src: '', fit: 'tile' as const, x: 0, y: 0, scale: 1, imageWidth: 100, imageHeight: 100 },
        },
      ],
    };
    const doc = {
      ...createDocument('Doc', true),
      rootChildren: ['n1'],
      nodes: { n1: imgShape },
    } as ReturnType<typeof createDocument> & {
      rootChildren: string[];
      nodes: Record<string, typeof imgShape>;
    };

    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      print: { enforceDpi: 300 },
    });
    const result = runExportPreflight(doc, request([config]));
    expect(result.findings.some((f) => f.code === 'low-effective-resolution')).toBe(false);
  });
});

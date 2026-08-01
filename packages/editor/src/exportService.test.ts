import { createDocument, type ExportBatch, type ExportJob, makeShapeNode } from '@strata/scene';
import { describe, expect, it, vi } from 'vitest';
import { type ExportRunContext, ExportService, rasterScaleForJob } from './exportService';

function svgBatch(nodeId = 'n1'): ExportBatch {
  return {
    jobs: [
      {
        presetId: 'p1',
        nodeId,
        nodeName: 'Logo',
        format: 'svg',
        fileName: 'Logo.svg',
        dimensions: { w: 20, h: 10 },
        estimatedSize: 1024,
        status: 'pending',
      },
    ],
    destinationFolder: null,
    filenameTemplate: '{name}.{ext}',
    folderRule: 'flat',
  };
}

describe('ExportService', () => {
  it('exports SVG jobs through the save sink and reports success', async () => {
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Logo' });
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    const saveFile = vi.fn<NonNullable<ExportRunContext['saveFile']>>(
      async () => '/exports/Logo.svg',
    );

    const report = await ExportService.run(svgBatch(), { document: doc, saveFile });

    expect(report.successCount).toBe(1);
    expect(report.failureCount).toBe(0);
    expect(report.files[0]).toMatchObject({
      fileName: 'Logo.svg',
      status: 'success',
      mimeType: 'image/svg+xml',
      savedPath: '/exports/Logo.svg',
    });
    expect(saveFile).toHaveBeenCalledOnce();
    const call = saveFile.mock.calls[0];
    if (!call) throw new Error('Expected saveFile call');
    const [, bytes, mime] = call;
    expect(mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(bytes as Uint8Array)).toContain('<svg');
  });

  it('resolves raster scale from factor, width, and height presets', () => {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      { name: 'Logo' },
    );
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    const baseJob: ExportJob = {
      ...svgBatch().jobs[0]!,
      format: 'png',
      fileName: 'Logo.png',
      dimensions: { w: 200, h: 100 },
    };

    expect(
      rasterScaleForJob({ ...baseJob, scale: { type: 'factor', value: 3 } }, { document: doc }),
    ).toBe(3);
    expect(
      rasterScaleForJob({ ...baseJob, scale: { type: 'width', pixels: 400 } }, { document: doc }),
    ).toBe(2);
    expect(
      rasterScaleForJob({ ...baseJob, scale: { type: 'height', pixels: 50 } }, { document: doc }),
    ).toBe(0.5);
  });

  it('reports missing nodes without claiming success', async () => {
    const doc = createDocument('Doc', true);
    const report = await ExportService.run(svgBatch('missing'), { document: doc });

    expect(report.successCount).toBe(0);
    expect(report.failureCount).toBe(1);
    expect(report.files[0]).toMatchObject({
      status: 'failed',
      error: 'Node missing was not found',
    });
  });

  it('honors an already-aborted signal before exporting', async () => {
    const controller = new AbortController();
    controller.abort();
    const doc = createDocument('Doc', true);

    await expect(
      ExportService.run(svgBatch(), { document: doc }, controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('attaches preflight findings to the report', async () => {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      { name: 'Photo' },
    );
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    const saveFile = vi.fn(async () => '/exports/Photo.jpg');

    const batch = {
      ...svgBatch('n1'),
      jobs: [
        {
          ...svgBatch('n1').jobs[0]!,
          format: 'jpg' as const,
          fileName: 'Photo.jpg',
          dimensions: { w: 200, h: 100 },
        },
      ],
    };

    const report = await ExportService.run(batch, { document: doc, saveFile });

    // The raster render needs an engine (absent here), but preflight runs
    // before execution and must report the flattening finding regardless.
    expect(report.findings?.some((f) => f.code === 'transparent-background-flattened')).toBe(true);
  });

  it('reports desktop-required PDF/X jobs with a clear failure on web', async () => {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      { name: 'Print' },
    );
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };

    const batch = {
      ...svgBatch('n1'),
      jobs: [
        {
          ...svgBatch('n1').jobs[0]!,
          format: 'pdf-x1a' as const,
          fileName: 'Print.pdf',
          dimensions: { w: 200, h: 100 },
        },
      ],
    };

    const report = await ExportService.run(batch, { document: doc });

    expect(report.failureCount).toBe(1);
    expect(report.files[0]?.error).toContain('desktop app');
    expect(report.findings?.some((f) => f.code === 'format-platform-unavailable')).toBe(true);
  });

  it('rejects unsupported formats from the capability contract', async () => {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      { name: 'Thing' },
    );
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };

    const batch = {
      ...svgBatch('n1'),
      jobs: [
        {
          ...svgBatch('n1').jobs[0]!,
          format: 'avif' as const,
          fileName: 'Thing.avif',
          dimensions: { w: 200, h: 100 },
        },
      ],
    };

    const report = await ExportService.run(batch, { document: doc });
    expect(report.failureCount).toBe(1);
    expect(report.files[0]?.error).toContain('AVIF');
  });
});

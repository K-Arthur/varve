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

  it('reports real executor stages and completed counts in order', async () => {
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Logo' });
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    const events: Array<{ stage: string; completed: number; currentFile?: string }> = [];

    await ExportService.run(svgBatch(), {
      document: doc,
      saveFile: async () => '/exports/Logo.svg',
      onProgress: (event) => events.push(event),
    });

    expect(events.map((event) => event.stage)).toEqual([
      'preflight',
      'rendering',
      'encoding',
      'writing',
      'completed',
    ]);
    expect(events.at(-1)).toMatchObject({ completed: 1, currentFile: 'Logo.svg' });
  });

  it('does not convert cancellation during writing into a failed output', async () => {
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Logo' });
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    const controller = new AbortController();

    await expect(
      ExportService.run(
        svgBatch(),
        {
          document: doc,
          saveFile: async () => {
            controller.abort();
            const error = new Error('Export aborted');
            error.name = 'AbortError';
            throw error;
          },
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
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

  it('exports PDF/X through the native print pipeline on desktop', async () => {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      { name: 'Print' },
    );
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };

    const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      if (command === 'export_pdfx4') return [0x25, 0x50, 0x44, 0x46]; // %PDF
      throw new Error(`unexpected command: ${command}`);
    });
    (window as unknown as Record<string, unknown>).__TAURI__ = { core: { invoke } };

    try {
      const batch = {
        ...svgBatch('n1'),
        jobs: [
          {
            ...svgBatch('n1').jobs[0]!,
            format: 'pdf-x4' as const,
            fileName: 'Print.pdf',
            dimensions: { w: 200, h: 100 },
          },
        ],
      };

      const report = await ExportService.run(batch, { document: doc }, undefined, 'tauri');

      expect(report.failureCount).toBe(0);
      expect(report.files[0]?.mimeType).toBe('application/pdf');
      expect(invoke).toHaveBeenCalledWith('export_pdfx4', expect.anything());

      // The Rust command deserializes PdfXOptions with rename_all="camelCase";
      // snake_case keys would silently fall back to serde defaults.
      const args = invoke.mock.calls[0]?.[1] as unknown as {
        options_json: string;
        page_height: number;
      };
      const options = JSON.parse(args.options_json) as Record<string, unknown>;
      expect(options.format).toBe('pdf-x4');
      expect(options).toHaveProperty('includeCropMarks');
      expect(options).toHaveProperty('bleedMm');
      expect(args.page_height).toBe(100);
    } finally {
      (window as unknown as Record<string, unknown>).__TAURI__ = undefined;
    }
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

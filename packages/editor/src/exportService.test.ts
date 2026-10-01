import {
  addChild,
  createDocument,
  type Document,
  type ExportBatch,
  type ExportJob,
  makeFrameNode,
  makeShapeNode,
  patternFill,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  type ExportRunContext,
  ExportService,
  isMultiFileExportFormat,
  rasterScaleForJob,
  svgPatternFallbackWarning,
} from './exportService';

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

  it('exports a supported pattern fill as a reusable SVG paint server', async () => {
    const tile =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8tgAAAABJRU5ErkJggg==';
    const definition = {
      id: 'pattern-dots',
      name: 'Dots',
      revision: 1,
      cell: { x: 0, y: 0, width: 8, height: 8 },
      repeat: {
        arrangement: 'grid',
        gapX: 0,
        gapY: 0,
        rowShift: 0,
        columnShift: 0,
        mirrorX: false,
        mirrorY: false,
        originX: 0,
        originY: 0,
      },
      source: { kind: 'raster', assetId: 'tile-asset', width: 8, height: 8 },
      previewSrc: tile,
    } as const;
    const node = {
      ...makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { name: 'Patterned logo' },
      ),
      fills: [
        {
          type: 'pattern',
          visible: true,
          pattern: {
            tileSrc: tile,
            definitionId: definition.id,
            spacing: 0,
            rotation: 0,
            imageWidth: 8,
            imageHeight: 8,
          },
          opacity: 0.6,
          blendMode: 'normal',
        },
      ],
    } as any;
    const doc = {
      ...createDocument('Doc', true),
      rootChildren: ['n1'],
      nodes: { n1: node },
      patternDefinitions: { [definition.id]: definition },
      assets: {
        'tile-asset': {
          id: 'tile-asset',
          kind: 'image',
          mimeType: 'image/png',
          dataUrl: tile,
          name: 'dots.png',
        },
      },
    } as any as Document;
    let output = '';

    const report = await ExportService.run(svgBatch(), {
      document: doc,
      saveFile: async (_fileName, bytes) => {
        output = new TextDecoder().decode(bytes);
        return '/exports/Logo.svg';
      },
    });

    expect(report.successCount).toBe(1);
    expect(output).toContain('<pattern');
    expect(output).toContain('patternUnits="userSpaceOnUse"');
    expect(output).toContain('fill-opacity="0.6"');
    expect(output).toContain('data:image/png;base64');
    expect(report.files[0]?.warnings).toEqual([]);
  });

  it('explains why an unsupported pattern needs the SVG raster fallback', () => {
    const node = {
      ...makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { name: 'Inline pattern' },
      ),
      fills: [
        {
          type: 'pattern',
          visible: true,
          pattern: {
            tileSrc:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8tgAAAABJRU5ErkJggg==',
            spacing: 0,
            rotation: 0,
          },
          opacity: 1,
          blendMode: 'normal',
        },
      ],
    } as any;
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };

    expect(svgPatternFallbackWarning(node, doc).join(' ')).toMatch(
      /Only reusable pattern definitions/,
    );
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

  it('treats a cancelled save picker as cancellation instead of success', async () => {
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Logo' });
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };

    await expect(
      ExportService.run(svgBatch(), { document: doc, saveFile: async () => null }),
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

  it('fails PDF/X when a visible pattern has no source instead of exporting missing artwork', async () => {
    const node = {
      ...makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Print' }),
      fills: [
        patternFill('', { definitionId: 'missing-pattern', imageWidth: 16, imageHeight: 16 }),
      ],
    };
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    const invoke = vi.fn(async () => [0x25, 0x50, 0x44, 0x46]);
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

      expect(report.failureCount).toBe(1);
      expect(report.files[0]?.error).toMatch(/pattern.*no tile source/i);
      expect(invoke).not.toHaveBeenCalled();
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

  describe('multi-file code deliverables', () => {
    function cardDoc(): Document {
      const frame = makeFrameNode('n1', { name: 'Card', w: 320, h: 200 });
      const badge = makeShapeNode(
        'badge',
        { kind: 'rect', x: 8, y: 8, w: 40, h: 20 },
        { name: 'Badge' },
      );
      let doc: Document = {
        ...createDocument('Doc', true),
        rootChildren: ['n1'],
        nodes: { n1: frame },
      };
      doc = addChild(doc, 'n1', badge);
      return doc;
    }

    function codeBatch(format: 'react-cssmodules' | 'react-tailwind', fileName: string) {
      return {
        ...svgBatch('n1'),
        jobs: [
          {
            ...svgBatch('n1').jobs[0]!,
            format,
            fileName,
            dimensions: { w: 320, h: 200 },
          },
        ],
      };
    }

    it('writes a component and its stylesheet as separate files', async () => {
      const written: Array<{ name: string; body: string; mime: string }> = [];
      const report = await ExportService.run(codeBatch('react-cssmodules', 'Card.tsx'), {
        document: cardDoc(),
        saveFile: async (fileName, bytes, mimeType) => {
          written.push({
            name: fileName,
            body: new TextDecoder().decode(bytes),
            mime: mimeType,
          });
          return `/exports/${fileName}`;
        },
      });

      expect(report.failureCount).toBe(0);
      expect(written.map((file) => file.name)).toEqual(['Card.tsx', 'Card.module.css']);
      // The TSX must not contain the stylesheet payload.
      expect(written[0]!.body).toContain('import styles from');
      expect(written[0]!.body).not.toContain('position: absolute');
      expect(written[1]!.mime).toBe('text/css');
      expect(written[1]!.body).toContain('position: absolute');
      // The child survives the export.
      expect(written[1]!.body).toContain('.badge');
      expect(report.files[0]?.additionalFiles).toEqual(['Card.module.css']);
    });

    it('keeps both generated files sharing the job filename stem', async () => {
      const names: string[] = [];
      await ExportService.run(codeBatch('react-cssmodules', 'Hero Card.tsx'), {
        document: cardDoc(),
        saveFile: async (fileName) => {
          names.push(fileName);
          return fileName;
        },
      });

      const stems = names.map((name) => name.replace(/\.module\.css$/, '').replace(/\.tsx$/, ''));
      expect(new Set(stems).size).toBe(1);
    });

    it('emits a real importable component for the Tailwind target', async () => {
      const written: string[] = [];
      await ExportService.run(codeBatch('react-tailwind', 'Card.tsx'), {
        document: cardDoc(),
        saveFile: async (_fileName, bytes) => {
          written.push(new TextDecoder().decode(bytes));
          return 'Card.tsx';
        },
      });

      expect(written).toHaveLength(1);
      expect(written[0]).toContain('export function Card()');
      expect(written[0]).toContain('<>');
      // Children survive: the badge is a nested absolutely-positioned div.
      expect(written[0]).toContain('left-[8px]');
      expect(written[0]).toContain('w-[40px]');
    });

    it('flags multi-file formats so browser batches are archived, not double-downloaded', () => {
      expect(isMultiFileExportFormat('react-cssmodules')).toBe(true);
      expect(isMultiFileExportFormat('react-tailwind')).toBe(false);
      expect(isMultiFileExportFormat('svg')).toBe(false);
    });
  });
});

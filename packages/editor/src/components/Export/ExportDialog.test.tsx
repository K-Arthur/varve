// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDocument } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildJobs, ExportDialog } from './ExportDialog';

vi.mock('../../motion/videoExportBridge', () => ({
  createVideoFrameRenderer: vi.fn(),
}));

afterEach(cleanup);

function mockNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    name: 'Rectangle 1',
    kind: 'shape' as const,
    transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    index: 0,
    order: 'a0',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    strokes: [],
    effects: [],
    presets: [
      {
        id: 'p1',
        format: 'png' as const,
        scale: { type: 'factor' as const, value: 2 },
        suffix: '@2x',
        enabled: true,
      },
    ],
    ...overrides,
  };
}

describe('ExportDialog', () => {
  it('carries configuration-specific encoder options into executable jobs', () => {
    const node = mockNode({
      presets: [
        {
          id: 'jpeg-high',
          format: 'jpg',
          scale: { type: 'factor', value: 1 },
          suffix: '-high',
          enabled: true,
          raster: {
            scale: { type: 'factor', value: 1 },
            quality: 0.92,
            transparency: false,
            matteColor: [255, 255, 255, 255],
          },
        },
      ],
    });

    expect(buildJobs([node])[0]).toMatchObject({
      suffix: '-high',
      raster: {
        quality: 0.92,
        transparency: false,
        matteColor: [255, 255, 255, 255],
      },
    });
  });

  it('applies the filename template and organization rule to the executed batch', async () => {
    const onExport = vi.fn(async () => undefined);
    render(
      <ExportDialog isOpen={true} onClose={() => {}} nodes={[mockNode()]} onExport={onExport} />,
    );

    fireEvent.change(screen.getByLabelText('Filename template'), {
      target: { value: '{name}-{width}.{ext}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'By format' }));
    fireEvent.click(screen.getByRole('button', { name: /Export \(1\)/ }));

    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    const batch = onExport.mock.calls[0]?.[0] as { jobs: Array<{ fileName: string }> };
    expect(batch.jobs[0]?.fileName).toBe('png/Rectangle 1-200.png');
  });

  it('renders when isOpen is true', () => {
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    expect(container.querySelector('.export-dialog-overlay')).toBeTruthy();
    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ExportDialog
        isOpen={false}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    expect(container.querySelector('.export-dialog-overlay')).toBeNull();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(
      <ExportDialog
        isOpen={true}
        onClose={onClose}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('has correct aria attributes', () => {
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    const overlay = container.querySelector('.export-dialog-overlay');
    expect(overlay?.getAttribute('role')).toBe('dialog');
    expect(overlay?.getAttribute('aria-modal')).toBe('true');
    expect(overlay?.getAttribute('aria-label')).toBe('Export');
  });

  it('closes on overlay click', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={onClose}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    const overlay = container.querySelector('.export-dialog-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('safe filename generation removes special chars', () => {
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode({ name: 'test/file<>:"|?*.png' })]}
        onExport={async () => {}}
      />,
    );
    const fileNameEl = container.querySelector('.batch-job-row__name');
    expect(fileNameEl?.textContent).toContain('test');
  });

  it('computes job dimensions from width presets and node bounds', () => {
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[
          mockNode({
            presets: [
              {
                id: 'p-width',
                format: 'png' as const,
                scale: { type: 'width' as const, pixels: 400 },
                suffix: '400w',
                enabled: true,
              },
            ],
          }),
        ]}
        onExport={async () => {}}
      />,
    );

    expect(container.querySelector('.batch-job-row__dims')?.textContent).toBe('400x320');
  });

  it('builds jobs through the canonical plan with consistent naming', () => {
    const doc = createDocument('Export', true);
    const node = mockNode({ name: 'Logo' });
    const fullDoc = { ...doc, rootChildren: ['n1'], nodes: { n1: node } };

    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[node]}
        document={fullDoc}
        onExport={async () => {}}
      />,
    );

    // Canonical naming: '@2x' suffix must not get an extra '-' separator.
    expect(container.querySelector('.batch-job-row__name')?.textContent).toBe('Logo@2x.png');
    expect(container.querySelector('.batch-job-row__dims')?.textContent).toBe('200x160');
  });

  it('shows close button when not running', () => {
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('announces failed export reports without claiming completion', async () => {
    const onExport = vi.fn(async () => ({
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      totalJobs: 1,
      successCount: 0,
      failureCount: 1,
      files: [],
    }));
    render(
      <ExportDialog isOpen={true} onClose={() => {}} nodes={[mockNode()]} onExport={onExport} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Export \(1\)/ }));

    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText('Export failed: 1 of 1 files failed')).toBeInTheDocument(),
    );
  });

  it('passes an AbortSignal and aborts the batch via the Cancel button', async () => {
    let capturedSignal: AbortSignal | undefined;
    const onExport = vi.fn((_batch: unknown, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });
    render(
      <ExportDialog isOpen={true} onClose={() => {}} nodes={[mockNode()]} onExport={onExport} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Export \(1\)/ }));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('runs package export as a separate action', async () => {
    const onPackageExport = vi.fn(async () => {});
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
        onPackageExport={onPackageExport}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Package' }));

    await waitFor(() => expect(onPackageExport).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('Package export complete')).toBeInTheDocument());
  });

  it('surfaces preflight findings in the dialog', () => {
    // JPEG flattens a transparent background, producing a deterministic warning.
    const node = mockNode({
      presets: [
        {
          id: 'p1',
          format: 'jpg' as const,
          scale: { type: 'factor' as const, value: 1 },
          suffix: '',
          enabled: true,
        },
      ],
    });
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[node]}
        document={doc}
        onExport={async () => {}}
      />,
    );
    expect(screen.getAllByRole('region', { name: /preflight/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Preflight:/i)).toBeTruthy();
  });

  it('shows print settings when a PDF/X job is selected', () => {
    const node = mockNode({
      presets: [
        {
          id: 'p1',
          format: 'pdf-x1a' as const,
          scale: { type: 'factor' as const, value: 1 },
          suffix: '',
          enabled: true,
        },
      ],
    });
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[node]}
        document={doc}
        onExport={async () => {}}
      />,
    );
    expect(screen.getByText('Press / print settings (PDF/X-1a)')).toBeTruthy();
    expect(screen.getByLabelText('Bleed in millimetres')).toBeTruthy();
    expect(screen.getByLabelText('Crop marks')).toBeTruthy();
  });

  it('seeds the PDF/X bleed from the document bleed when configured', () => {
    const node = mockNode({
      presets: [
        {
          id: 'p1',
          format: 'pdf-x1a' as const,
          scale: { type: 'factor' as const, value: 1 },
          suffix: '',
          enabled: true,
        },
      ],
    });
    // 5mm bleed on a document with a page: the export-job bleed must match
    // the canonical document bleed (5mm), not the app default.
    const doc = {
      ...createDocument('Doc', false),
      bleed: { top: 5, right: 5, bottom: 5, left: 5, linked: true, unit: 'mm' },
      rootChildren: ['n1'],
      nodes: { n1: node },
    };
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[node]}
        document={doc}
        onExport={async () => {}}
      />,
    );
    const input = screen.getByLabelText('Bleed in millimetres') as HTMLInputElement;
    expect(input.value).toBe('5');
    expect(screen.getByText(/Document bleed: 5\.00 mm/)).toBeTruthy();
  });

  it('seeds the PDF/X bleed from a page override when the page has one', () => {
    const node = mockNode({
      presets: [
        {
          id: 'p1',
          format: 'pdf-x1a' as const,
          scale: { type: 'factor' as const, value: 1 },
          suffix: '',
          enabled: true,
        },
      ],
    });
    // Document default 3mm, page override 8mm — the page's resolved bleed
    // wins (canvas, inspector and export resolve the same way).
    const doc = {
      ...createDocument('Doc', false),
      bleed: { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' },
      activePageId: 'p1',
      pages: [
        {
          id: 'p1',
          name: 'Page 1',
          order: 'a0',
          width: 1920,
          height: 1080,
          backgrounds: [],
          contentRoot: 'cr1',
          bleed: { top: 8, right: 8, bottom: 8, left: 8, linked: true, unit: 'mm' },
        },
      ],
      rootChildren: ['n1'],
      nodes: { n1: node },
    };
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[node]}
        document={doc}
        onExport={async () => {}}
      />,
    );
    const input = screen.getByLabelText('Bleed in millimetres') as HTMLInputElement;
    expect(input.value).toBe('8');
    expect(screen.getByText(/Document bleed: 8\.00 mm/)).toBeTruthy();
  });

  it('falls back to the app export default when the document has no bleed', () => {
    const node = mockNode({
      presets: [
        {
          id: 'p1',
          format: 'pdf-x1a' as const,
          scale: { type: 'factor' as const, value: 1 },
          suffix: '',
          enabled: true,
        },
      ],
    });
    const doc = { ...createDocument('Doc', false), rootChildren: ['n1'], nodes: { n1: node } };
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[node]}
        document={doc}
        onExport={async () => {}}
      />,
    );
    const input = screen.getByLabelText('Bleed in millimetres') as HTMLInputElement;
    // App default is 3mm (settings.ts) — untouched by the document.
    expect(input.value).toBe('3');
    expect(screen.getByText(/has no bleed configured/)).toBeTruthy();
  });

  it('attaches print settings to PDF/X jobs in the exported batch', async () => {
    const node = mockNode({
      presets: [
        {
          id: 'p1',
          format: 'pdf-x4' as const,
          scale: { type: 'factor' as const, value: 1 },
          suffix: '',
          enabled: true,
        },
      ],
    });
    const doc = { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
    let receivedBatch: unknown;
    const onExport = vi.fn(async (batch: unknown) => {
      receivedBatch = batch;
      return { totalJobs: 1, successCount: 1, failureCount: 0, files: [] };
    });
    // F-32 preflight gate (2026-08-10): handleExport blocks on
    // error-severity findings via window.confirm; this batch's pdf-x4
    // job on the default web platform is flagged, so confirm must resolve
    // as a user clicking "Export anyway".
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[node]}
        document={doc}
        onExport={onExport}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Export \(1\)/ }));

    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    confirmSpy.mockRestore();
    const jobs = (receivedBatch as { jobs: Array<{ format: string; print?: unknown }> }).jobs;
    expect(jobs[0]?.format).toBe('pdf-x4');
    expect(jobs[0]?.print).toMatchObject({ bleedMm: expect.any(Number) });
  });

  it('renders per-file results and retries only failed outputs', async () => {
    let firstBatch: unknown;
    const onExport = vi.fn(async (batch: unknown) => {
      if (onExport.mock.calls.length === 1) firstBatch = batch;
      const job = (batch as { jobs: Array<{ fileName: string; nodeId: string; presetId: string }> })
        .jobs[0];
      if (!job) return { totalJobs: 0, successCount: 0, failureCount: 0, files: [] };
      if (onExport.mock.calls.length === 1) {
        return {
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          totalJobs: 1,
          successCount: 0,
          failureCount: 1,
          files: [
            {
              fileName: job.fileName,
              format: 'png' as const,
              nodeId: job.nodeId,
              status: 'failed' as const,
              mimeType: 'application/octet-stream',
              byteCount: 0,
              durationMs: 5,
              error: 'Engine not ready',
              warnings: [],
            },
          ],
        };
      }
      return {
        startedAt: 3,
        completedAt: 4,
        durationMs: 1,
        totalJobs: 1,
        successCount: 1,
        failureCount: 0,
        files: [
          {
            fileName: job.fileName,
            format: 'png' as const,
            nodeId: job.nodeId,
            status: 'success' as const,
            mimeType: 'image/png',
            byteCount: 100,
            durationMs: 5,
            warnings: [],
          },
        ],
      };
    });
    render(
      <ExportDialog isOpen={true} onClose={() => {}} nodes={[mockNode()]} onExport={onExport} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Export \(1\)/ }));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Engine not ready')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Retry failed \(1\)/ }));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(2));
    const retryCall = onExport.mock.calls[1];
    if (!retryCall) throw new Error('Expected a retry export call');
    const retryBatch = (retryCall[0] as { jobs: unknown[] }).jobs;
    expect(retryBatch).toHaveLength(1);
    expect((firstBatch as { jobs: unknown[] }).jobs).toHaveLength(1);
  });
});

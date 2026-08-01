// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from './ExportDialog';

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
});

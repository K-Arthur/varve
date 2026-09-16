import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEngine } from '@varve/engine';
import { createDocument, makeShapeNode, type SceneNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { AssetExportControls } from './AssetExportControls';

/**
 * Desktop (Tauri) quick-export feedback.
 *
 * `exportNodeAsRaster` needs a canvas that jsdom does not implement, so the
 * spec-panel export helpers are replaced with their I/O contract: a resolved
 * blob (success), an abort, or a cancelled native save dialog (`saveBinaryFile`
 * resolving to null). The point under test is the message the user sees — a
 * cancelled save must never be reported as a completed export.
 */
vi.mock('./export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./export')>();
  return {
    ...actual,
    exportNodeAsRaster: vi.fn(async () => ({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      warnings: [] as string[],
    })),
    exportNodeToSvgMarkup: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" />'),
  };
});

function node(): SceneNode {
  return makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' });
}

describe('AssetExportControls — desktop save feedback', () => {
  it('reports a cancelled raster save instead of success', async () => {
    const doc = createDocument('Export', true);
    const engine = await createEngine('stub');
    const saveBinaryFile = vi.fn(
      async (_name: string, _bytes: Uint8Array, _mime: string, _ext: string) => null,
    );
    render(
      <AssetExportControls
        engine={engine}
        node={node()}
        doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node() } }}
        platform={{ kind: 'tauri', saveBinaryFile } as never}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'PNG' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }));

    await waitFor(() => expect(saveBinaryFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText('Export cancelled').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Exported Logo as PNG/)).not.toBeInTheDocument();
  });

  it('reports a completed raster save with the scale it used', async () => {
    const doc = createDocument('Export', true);
    const engine = await createEngine('stub');
    const saveBinaryFile = vi.fn(
      async (_name: string, _bytes: Uint8Array, _mime: string, _ext: string) => '/tmp/logo@2x.png',
    );
    render(
      <AssetExportControls
        engine={engine}
        node={node()}
        doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node() } }}
        platform={{ kind: 'tauri', saveBinaryFile } as never}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'PNG' }));
    fireEvent.click(screen.getByRole('radio', { name: '2x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }));

    await waitFor(() => expect(saveBinaryFile).toHaveBeenCalledTimes(1));
    expect(saveBinaryFile.mock.calls[0]?.[0]).toBe('Logo@2x.png');
    await waitFor(() =>
      expect(screen.getAllByText(/Exported Logo as PNG at 2x/).length).toBeGreaterThan(0),
    );
  });

  it('reports a cancelled SVG save instead of success', async () => {
    const doc = createDocument('Export', true);
    const saveBinaryFile = vi.fn(
      async (_name: string, _bytes: Uint8Array, _mime: string, _ext: string) => null,
    );
    render(
      <AssetExportControls
        node={node()}
        doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node() } }}
        platform={{ kind: 'tauri', saveBinaryFile } as never}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'SVG' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export SVG' }));

    await waitFor(() => expect(saveBinaryFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText('Export cancelled').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Exported Logo as SVG/)).not.toBeInTheDocument();
  });
});

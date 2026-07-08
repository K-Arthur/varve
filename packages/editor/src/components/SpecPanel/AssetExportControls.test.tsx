import { createDocument, makeShapeNode } from '@strata/scene';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetExportControls } from './AssetExportControls';

describe('AssetExportControls', () => {
  it('saves SVG exports as SVG bytes instead of raster bytes', async () => {
    const doc = createDocument('Export', true);
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Logo' });
    const saved: { bytes: Uint8Array; mime: string; ext: string }[] = [];

    render(
      <AssetExportControls
        node={node}
        doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
        engine={undefined}
        platform={
          {
            kind: 'tauri',
            saveBinaryFile: vi.fn(async (_name, bytes, mime, ext) => {
              saved.push({ bytes, mime, ext });
              return '/tmp/logo.svg';
            }),
          } as never
        }
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SVG' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const text = new TextDecoder().decode(saved[0]?.bytes);
    expect(saved[0]).toMatchObject({ mime: 'image/svg+xml', ext: '.svg' });
    expect(text).toContain('<svg');
    expect(text.startsWith('\uFFFDPNG')).toBe(false);
  });
});

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

  it('pre-fills the format from exportAdvisor.suggestExportFormat', () => {
    const doc = createDocument('Export', true);
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Icon' });

    render(
      <AssetExportControls
        node={node}
        doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
      />,
    );

    // A vector rect shape suggests SVG (see exportAdvisor.ts isVectorNode branch).
    expect(screen.getByRole('button', { name: 'SVG' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the advisor reason in a title tooltip', () => {
    const doc = createDocument('Export', true);
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Icon' });

    render(
      <AssetExportControls
        node={node}
        doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
      />,
    );

    expect(screen.getByLabelText(/why/i)).toHaveAttribute(
      'title',
      'Vector path exports losslessly as SVG',
    );
  });

  it('re-suggests when the selected node changes', () => {
    const doc = createDocument('Export', true);
    const vectorNode = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
      { name: 'Icon' },
    );
    const bigNode = makeShapeNode(
      'n2',
      { kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 },
      { name: 'Banner' },
    );
    const fullDoc = {
      ...doc,
      rootChildren: ['n1', 'n2'],
      nodes: { n1: vectorNode, n2: bigNode },
    };

    const { rerender } = render(<AssetExportControls node={vectorNode} doc={fullDoc} />);
    expect(screen.getByRole('button', { name: 'SVG' })).toHaveAttribute('aria-pressed', 'true');

    rerender(<AssetExportControls node={bigNode} doc={fullDoc} />);
    expect(screen.getByRole('button', { name: 'JPEG' })).toHaveAttribute('aria-pressed', 'true');
  });
});

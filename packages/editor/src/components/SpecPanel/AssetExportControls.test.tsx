import { createDocument, type ExportPreset, makeShapeNode, type SceneNode } from '@strata/scene';
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
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

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

  describe('per-node export settings', () => {
    const PRESETS: ExportPreset[] = [
      {
        id: 'p1',
        format: 'png',
        scale: { type: 'factor', value: 2 },
        suffix: '@2x',
        enabled: true,
      },
      { id: 'p2', format: 'svg', scale: { type: 'factor', value: 1 }, suffix: '', enabled: false },
    ];

    function nodeWithPresets(): SceneNode {
      return {
        ...makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' }),
        presets: PRESETS,
      };
    }

    it('renders the export settings section with canonical filenames', () => {
      const doc = createDocument('Export', true);
      render(
        <AssetExportControls
          node={nodeWithPresets()}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={() => {}}
        />,
      );
      expect(screen.getByText('Export settings')).toBeInTheDocument();
      expect(screen.getByText('Logo@2x.png')).toBeInTheDocument();
      expect(screen.getByText('Logo.svg')).toBeInTheDocument();
      expect(screen.getByLabelText('Enable Logo@2x.png export')).toBeChecked();
      expect(screen.getByLabelText('Enable Logo.svg export')).not.toBeChecked();
    });

    it('hides the settings section in read-only mode (no onAddPreset)', () => {
      const doc = createDocument('Export', true);
      render(
        <AssetExportControls
          node={nodeWithPresets()}
          doc={{ ...doc, nodes: { n1: nodeWithPresets() } }}
        />,
      );
      expect(screen.queryByText('Export settings')).not.toBeInTheDocument();
    });

    it('shows an empty state when no presets exist', () => {
      const doc = createDocument('Export', true);
      render(
        <AssetExportControls
          node={makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' })}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={() => {}}
        />,
      );
      expect(screen.getByText(/No export settings/)).toBeInTheDocument();
    });

    it('adds a preset seeded from the current format and scale', () => {
      const doc = createDocument('Export', true);
      const onAddPreset = vi.fn();
      render(
        <AssetExportControls
          node={makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' })}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={onAddPreset}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
      fireEvent.click(screen.getByRole('button', { name: '2x' }));
      fireEvent.click(screen.getByRole('button', { name: '+ Add export setting' }));

      expect(onAddPreset).toHaveBeenCalledOnce();
      const preset = onAddPreset.mock.calls[0]?.[0] as {
        format: string;
        scale: { type: string; value: number };
        suffix: string;
        enabled: boolean;
      };
      expect(preset.format).toBe('png');
      expect(preset.scale).toEqual({ type: 'factor', value: 2 });
      expect(preset.suffix).toBe('@2x');
      expect(preset.enabled).toBe(true);
    });

    it('adds a PDF preset using the legacy pdf-screen format', () => {
      const doc = createDocument('Export', true);
      const onAddPreset = vi.fn();
      render(
        <AssetExportControls
          node={makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' })}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          platform={{ kind: 'tauri' } as never}
          onAddPreset={onAddPreset}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
      fireEvent.click(screen.getByRole('button', { name: '+ Add export setting' }));

      const preset = onAddPreset.mock.calls[0]?.[0] as { format: string };
      expect(preset.format).toBe('pdf-screen');
    });

    it('toggles a preset enabled state via update', () => {
      const doc = createDocument('Export', true);
      const onUpdatePreset = vi.fn();
      render(
        <AssetExportControls
          node={nodeWithPresets()}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={() => {}}
          onUpdatePreset={onUpdatePreset}
        />,
      );
      fireEvent.click(screen.getByLabelText('Enable Logo@2x.png export'));
      expect(onUpdatePreset).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1', enabled: false }),
      );
    });

    it('removes a preset', () => {
      const doc = createDocument('Export', true);
      const onRemovePreset = vi.fn();
      render(
        <AssetExportControls
          node={nodeWithPresets()}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={() => {}}
          onRemovePreset={onRemovePreset}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Remove Logo@2x.png export' }));
      expect(onRemovePreset).toHaveBeenCalledWith('p1');
    });

    it('invokes the open-advanced-export callback', () => {
      const doc = createDocument('Export', true);
      const onOpenAdvancedExport = vi.fn();
      render(
        <AssetExportControls
          node={nodeWithPresets()}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={() => {}}
          onOpenAdvancedExport={onOpenAdvancedExport}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Open advanced export/ }));
      expect(onOpenAdvancedExport).toHaveBeenCalledOnce();
    });
  });
});

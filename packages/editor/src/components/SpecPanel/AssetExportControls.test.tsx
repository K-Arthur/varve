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
    fireEvent.click(screen.getByRole('button', { name: 'Export SVG' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const text = new TextDecoder().decode(saved[0]?.bytes);
    expect(saved[0]).toMatchObject({ mime: 'image/svg+xml', ext: '.svg' });
    expect(text).toContain('<svg');
    expect(text.startsWith('\uFFFDPNG')).toBe(false);
  });

  it('labels the primary action "Download" for browser delivery and "Export" for desktop saves', () => {
    const doc = createDocument('Export', true);
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Icon' });
    const fullDoc = { ...doc, rootChildren: ['n1'], nodes: { n1: node } };

    const { rerender } = render(<AssetExportControls node={node} doc={fullDoc} />);
    expect(screen.getByRole('button', { name: 'Download SVG' })).toBeInTheDocument();

    rerender(
      <AssetExportControls
        node={node}
        doc={fullDoc}
        platform={{ kind: 'tauri', saveBinaryFile: vi.fn() } as never}
      />,
    );
    expect(screen.getByRole('button', { name: 'Export SVG' })).toBeInTheDocument();
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

  describe('export settings (multi-configuration list)', () => {
    it('is not rendered when no preset callbacks are provided', () => {
      const doc = createDocument('Export', true);
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { name: 'Icon' },
      );
      render(
        <AssetExportControls
          node={node}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
        />,
      );
      expect(screen.queryByText('Export settings')).not.toBeInTheDocument();
    });

    it('shows the empty state when callbacks are provided but the node has no presets', () => {
      const doc = createDocument('Export', true);
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { name: 'Icon' },
      );
      render(
        <AssetExportControls
          node={node}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
          onAddPreset={vi.fn()}
        />,
      );
      expect(screen.getByText(/No export settings have been added/)).toBeInTheDocument();
    });

    it('seeds a new preset from the current quick-export format and scale on "Add export setting"', () => {
      const doc = createDocument('Export', true);
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { name: 'Icon' },
      );
      const onAddPreset = vi.fn();
      render(
        <AssetExportControls
          node={node}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
          onAddPreset={onAddPreset}
        />,
      );

      // Vector rect defaults to SVG (see exportAdvisor).
      fireEvent.click(screen.getByRole('button', { name: '+ Add export setting' }));

      expect(onAddPreset).toHaveBeenCalledTimes(1);
      expect(onAddPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'svg',
          scale: { type: 'factor', value: 1 },
          suffix: '',
          enabled: true,
        }),
      );
    });

    it('renders existing presets and wires toggle/suffix/remove to the provided callbacks', () => {
      const doc = createDocument('Export', true);
      const node = {
        ...makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Icon' }),
        presets: [
          {
            id: 'p1',
            format: 'png' as const,
            scale: { type: 'factor' as const, value: 2 },
            suffix: '@2x',
            enabled: true,
          },
        ],
      };
      const onUpdatePreset = vi.fn();
      const onRemovePreset = vi.fn();
      render(
        <AssetExportControls
          node={node}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
          onAddPreset={vi.fn()}
          onUpdatePreset={onUpdatePreset}
          onRemovePreset={onRemovePreset}
        />,
      );

      expect(screen.getByText('Icon@2x.png')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Enable PNG export setting' }));
      expect(onUpdatePreset).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));

      fireEvent.click(screen.getByRole('button', { name: 'Remove PNG export setting' }));
      expect(onRemovePreset).toHaveBeenCalledWith('p1');
    });

    it('invokes onOpenAdvancedExport when provided', () => {
      const doc = createDocument('Export', true);
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { name: 'Icon' },
      );
      const onOpenAdvancedExport = vi.fn();
      render(
        <AssetExportControls
          node={node}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
          onAddPreset={vi.fn()}
          onOpenAdvancedExport={onOpenAdvancedExport}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Open advanced export…' }));
      expect(onOpenAdvancedExport).toHaveBeenCalledTimes(1);
    });

    it('adds a quick preset with fixed format/scale in one click', () => {
      const doc = createDocument('Export', true);
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { name: 'Icon' },
      );
      const onAddPreset = vi.fn();
      render(
        <AssetExportControls
          node={node}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
          onAddPreset={onAddPreset}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'PNG 2x' }));

      expect(onAddPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'png',
          scale: { type: 'factor', value: 2 },
          suffix: '@2x',
          enabled: true,
        }),
      );
    });

    it('surfaces a preflight warning for an oversized export configuration', () => {
      const doc = createDocument('Export', true);
      const node = {
        ...makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }, { name: 'Banner' }),
        presets: [
          {
            id: 'p1',
            format: 'png' as const,
            scale: { type: 'factor' as const, value: 10 },
            suffix: '@10x',
            enabled: true,
          },
        ],
      };
      render(
        <AssetExportControls
          node={node}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
          onAddPreset={vi.fn()}
        />,
      );

      expect(screen.getByText(/preflight warning/)).toBeInTheDocument();
      expect(screen.getByText('Large output size')).toBeInTheDocument();
    });
  });

  describe('capability-driven format availability', () => {
    it('disables PDF with an explanatory reason in the browser and enables it on desktop', () => {
      const doc = createDocument('Export', true);
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { name: 'Icon' },
      );
      const fullDoc = { ...doc, rootChildren: ['n1'], nodes: { n1: node } };

      const { rerender } = render(<AssetExportControls node={node} doc={fullDoc} />);
      expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();

      rerender(
        <AssetExportControls
          node={node}
          doc={fullDoc}
          platform={{ kind: 'tauri', saveBinaryFile: vi.fn() } as never}
        />,
      );
      expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled();
    });
  });
});

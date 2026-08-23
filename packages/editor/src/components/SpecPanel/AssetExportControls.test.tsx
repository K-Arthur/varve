import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDocument, type ExportPreset, makeShapeNode, type SceneNode } from '@varve/scene';
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

  it('shows the advisor reason in an accessible tooltip on focus', () => {
    // Tooltip.tsx uses aria-describedby + a portaled role="tooltip" element,
    // not a native `title` attribute (which it actively warns against, since
    // native tooltips can't be styled, positioned, or read reliably by all
    // screen readers) — assert against the real pattern it implements.
    const doc = createDocument('Export', true);
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Icon' });

    render(
      <AssetExportControls
        node={node}
        doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
      />,
    );

    const infoButton = screen.getByLabelText(/why/i);
    fireEvent.focus(infoButton);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Vector path exports losslessly as SVG');
    expect(infoButton).toHaveAttribute('aria-describedby', tooltip.id);
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

  it('labels the primary action with the platform verb and selected format', () => {
    const doc = createDocument('Export', true);
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Icon' });
    const fullDoc = { ...doc, rootChildren: ['n1'], nodes: { n1: node } };

    const { rerender } = render(<AssetExportControls node={node} doc={fullDoc} />);
    expect(screen.getByRole('button', { name: 'Download SVG' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'JPEG' }));
    expect(screen.getByRole('button', { name: 'Download JPEG' })).toBeInTheDocument();

    rerender(
      <AssetExportControls node={node} doc={fullDoc} platform={{ kind: 'tauri' } as never} />,
    );
    expect(screen.getByRole('button', { name: 'Export JPEG' })).toBeInTheDocument();
  });

  it('offers screen PDF on web because the browser raster-PDF fallback is available', () => {
    const doc = createDocument('Export', true);
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Icon' });

    render(
      <AssetExportControls
        node={node}
        doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
      />,
    );

    expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled();
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
      expect(screen.getByRole('heading', { name: 'Quick export' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Export configurations' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Add configuration' })).toBeInTheDocument();
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
      expect(screen.queryByText('Export configurations')).not.toBeInTheDocument();
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
      expect(screen.getByText(/No saved configurations yet/)).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('combobox', { name: /Format for new export setting/i }));
      fireEvent.click(screen.getByRole('option', { name: 'PNG' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add configuration' }));

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

    it('offers print and code formats, and never offers unsupported AVIF', () => {
      const doc = createDocument('Export', true);
      render(
        <AssetExportControls
          node={makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' })}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          platform={{ kind: 'tauri' } as never}
          onAddPreset={() => {}}
        />,
      );

      fireEvent.click(screen.getByRole('combobox', { name: /Format for new export setting/i }));
      const options = screen.getAllByRole('option').map((o) => o.textContent);

      // Print formats reachable from the inspector (the regression that
      // deleting ExportPresetPanel introduced).
      expect(options).toContain('PDF/X-1a');
      expect(options).toContain('PDF/X-4');
      // Code formats.
      expect(options).toContain('React + Tailwind');
      expect(options).toContain('SwiftUI');
      expect(options).toContain('Flutter');
      // AVIF has no encoder (capability contract supported: false) — offering
      // it would be a UI that lies to users.
      expect(options.join(' ')).not.toMatch(/AVIF/i);
    });

    it('disables desktop-only print formats on web with an explanation', () => {
      const doc = createDocument('Export', true);
      render(
        <AssetExportControls
          node={makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' })}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={() => {}}
        />,
      );

      fireEvent.click(screen.getByRole('combobox', { name: /Format for new export setting/i }));
      const pdfx4 = screen
        .getAllByRole('option')
        .find((o) => o.textContent?.includes('PDF/X-4')) as HTMLElement;
      expect(pdfx4).toHaveTextContent(/desktop only/i);
      expect(pdfx4).toHaveAttribute('aria-disabled', 'true');
    });

    it('adds a print preset with the selected PDF/X standard on desktop', () => {
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

      fireEvent.click(screen.getByRole('combobox', { name: /Format for new export setting/i }));
      fireEvent.click(screen.getByRole('option', { name: 'PDF/X-4' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add configuration' }));

      const preset = onAddPreset.mock.calls[0]?.[0] as {
        format: string;
        scale: { value: number };
        suffix: string;
      };
      expect(preset.format).toBe('pdf-x4');
      // Press output is 1x document units — no @2x suffix.
      expect(preset.scale.value).toBe(1);
      expect(preset.suffix).toBe('');
    });

    it('applies a built-in catalog preset', () => {
      const doc = createDocument('Export', true);
      const onAddPreset = vi.fn();
      render(
        <AssetExportControls
          node={makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' })}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={onAddPreset}
        />,
      );

      fireEvent.click(screen.getByRole('combobox', { name: /Add from preset/i }));
      fireEvent.click(screen.getByRole('option', { name: 'PNG 2\u00d7 \u00b7 web' }));

      expect(onAddPreset).toHaveBeenCalledOnce();
      expect(onAddPreset.mock.calls[0]?.[0]).toMatchObject({
        format: 'png',
        scale: { type: 'factor', value: 2 },
        suffix: '@2x',
        enabled: true,
      });
    });

    it('preserves built-in raster settings instead of reducing a preset to format and scale', () => {
      const doc = createDocument('Export', true);
      const onAddPreset = vi.fn();
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
        { name: 'Photo' },
      );
      render(
        <AssetExportControls
          node={node}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: node } }}
          onAddPreset={onAddPreset}
        />,
      );

      fireEvent.click(screen.getByRole('combobox', { name: /Add from preset/i }));
      fireEvent.click(screen.getByRole('option', { name: 'JPEG high quality · web' }));

      expect(onAddPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'jpg',
          raster: expect.objectContaining({
            quality: 0.92,
            transparency: false,
            matteColor: [255, 255, 255, 255],
          }),
        }),
      );
    });

    it('applies a bundle as several export settings at once', () => {
      const doc = createDocument('Export', true);
      const onAddPreset = vi.fn();
      render(
        <AssetExportControls
          node={makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' })}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={onAddPreset}
        />,
      );

      fireEvent.click(screen.getByRole('combobox', { name: /Add from preset/i }));
      fireEvent.click(screen.getByRole('option', { name: /Web asset set/ }));

      // SVG + PNG 1x + PNG 2x — the point of the catalog: one click, real
      // multi-output, not a renamed default.
      expect(onAddPreset).toHaveBeenCalledTimes(3);
      const formats = onAddPreset.mock.calls.map((c) => (c[0] as { format: string }).format);
      expect(formats).toEqual(['svg', 'png', 'png']);
      const ids = onAddPreset.mock.calls.map((c) => (c[0] as { id: string }).id);
      expect(new Set(ids).size).toBe(3);
    });

    it('omits catalog presets whose format is unavailable on this platform', () => {
      const doc = createDocument('Export', true);
      render(
        <AssetExportControls
          node={makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Logo' })}
          doc={{ ...doc, rootChildren: ['n1'], nodes: { n1: nodeWithPresets() } }}
          onAddPreset={() => {}}
        />,
      );

      fireEvent.click(screen.getByRole('combobox', { name: /Add from preset/i }));
      const labels = screen.getAllByRole('option').map((o) => o.textContent ?? '');
      // Web platform: press presets are not encodable, so they are not offered.
      expect(labels.some((l) => /PDF\/X-4/.test(l))).toBe(false);
      expect(labels.some((l) => /PNG 1\u00d7/.test(l))).toBe(true);
    });

    it('edits a preset suffix', () => {
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

      fireEvent.change(screen.getByLabelText('Filename suffix for Logo@2x.png'), {
        target: { value: '@3x' },
      });
      expect(onUpdatePreset).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1', suffix: '@3x' }),
      );
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
      fireEvent.click(screen.getByRole('combobox', { name: /Format for new export setting/i }));
      fireEvent.click(screen.getByRole('option', { name: 'PDF (screen)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add configuration' }));

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
      expect(screen.getByText('Output dimensions were limited')).toBeInTheDocument();
    });
  });
});

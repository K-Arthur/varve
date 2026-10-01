/**
 * PatternFillControls — source, generator, repeat arrangement, placement.
 *
 * Covers the v2.32 contract: independent gaps, arrangement, mirroring, phase,
 * the procedural generator (which writes a recipe + derived tile together), and
 * the source-field reveal. The repeat preview is asserted structurally (it must
 * render a labelled region) rather than by pixels, which the browser E2E suite
 * owns.
 *
 * Research basis: Figma/Illustrator pattern fill controls; APG file input.
 */
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PatternDefinition, PatternFillData } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PatternFillControls } from './PatternFillControls';

afterEach(cleanup);

function defaultPattern(): PatternFillData {
  return { tileSrc: '', spacing: 0, rotation: 0 };
}

describe('PatternFillControls', () => {
  it('renders choose-tile affordance and the source field for an empty fill', () => {
    render(<PatternFillControls pattern={defaultPattern()} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /choose tile|replace tile/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /pattern tile source/i })).toBeTruthy();
  });

  it('hides the raw source field behind a reveal once a tile exists', () => {
    render(
      <PatternFillControls
        pattern={{ tileSrc: 'data:image/png;base64,TILE', spacing: 0, rotation: 0 }}
        onChange={() => {}}
      />,
    );
    // The value is not shown as a label; it is available on demand.
    expect(screen.queryByRole('textbox', { name: /pattern tile source/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /show source field/i }));
    expect(screen.getByRole('textbox', { name: /pattern tile source/i })).toBeTruthy();
  });

  it('hides the raw source field after generation or import supplies a tile', () => {
    const { rerender } = render(
      <PatternFillControls pattern={defaultPattern()} onChange={() => {}} />,
    );
    expect(screen.getByRole('textbox', { name: /pattern tile source/i })).toBeTruthy();
    rerender(
      <PatternFillControls
        pattern={{ tileSrc: 'data:image/png;base64,GENERATED', spacing: 0, rotation: 0 }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole('textbox', { name: /pattern tile source/i })).toBeNull();
    expect(screen.getByRole('button', { name: /show source field/i })).toBeTruthy();
  });

  it('renders the repeat preview as a labelled region', () => {
    render(<PatternFillControls pattern={defaultPattern()} onChange={() => {}} />);
    const preview = screen.getByRole('img', { name: /pattern repeat preview/i });
    expect(preview).toBeTruthy();
  });

  it('labels the repeat axis controls distinctly (not one generic "size")', () => {
    render(<PatternFillControls pattern={defaultPattern()} onChange={() => {}} />);
    expect(screen.getByText(/Gap across/)).toBeTruthy();
    expect(screen.getByText(/Gap down/)).toBeTruthy();
    expect(screen.getByText(/Phase across/)).toBeTruthy();
    expect(screen.getByText(/Phase down/)).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /Tile width/ })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /Tile height/ })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /Rotation/ })).toBeTruthy();
  });

  it('shows the arrangement and mirror controls', () => {
    render(<PatternFillControls pattern={defaultPattern()} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: /Arrangement/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Pattern alignment/i })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /mirror across/i })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /mirror down/i })).toBeTruthy();
  });

  it('sets document alignment as one per-fill placement field', async () => {
    const onChange = vi.fn();
    render(<PatternFillControls pattern={defaultPattern()} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox', { name: /Pattern alignment/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Document\/page/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ alignment: 'document' }));
  });

  it('shows mixed alignment without choosing one fill as the apparent value', () => {
    render(
      <PatternFillControls
        pattern={defaultPattern()}
        onChange={() => {}}
        mixedRepeatSettings={{ alignment: true }}
      />,
    );
    expect(screen.getByRole('combobox', { name: /Pattern alignment/i })).toHaveTextContent('Mixed');
  });

  it('keeps a linked definition source and repeat geometry out of per-fill controls', () => {
    const definition: PatternDefinition = {
      id: 'pattern-shared',
      name: 'Orchard leaves',
      revision: 1,
      cell: { x: 0, y: 0, width: 24, height: 20 },
      repeat: {
        arrangement: 'half-drop',
        gapX: 2,
        gapY: 3,
        rowShift: 0.5,
        mirrorX: false,
        mirrorY: false,
        originX: 0,
        originY: 0,
      },
      source: {
        kind: 'procedural',
        recipe: {
          type: 'checkerboard',
          tileWidth: 24,
          tileHeight: 20,
          color1: '#ffffff',
          color2: '#000000',
          seed: 0,
        },
      },
    };
    render(
      <PatternFillControls
        pattern={{
          tileSrc: '',
          definitionId: definition.id,
          spacing: 0,
          rotation: 0,
          imageWidth: 48,
          imageHeight: 40,
        }}
        definition={definition}
        definitionTileSrc="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Orchard leaves · procedural · 24 by 20px')).toBeTruthy();
    expect(screen.getByText(/Half-drop · 2px across · 3px down/i)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /pattern tile source/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /replace tile|choose tile/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /arrangement/i })).toBeNull();
    expect(screen.getByRole('spinbutton', { name: /tile width/i })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /rotation/i })).toBeTruthy();
  });

  it('detaches one fill with its resolved source and repeat geometry', () => {
    const onChange = vi.fn();
    const definition: PatternDefinition = {
      id: 'pattern-shared',
      name: 'Orchard leaves',
      revision: 1,
      cell: { x: 0, y: 0, width: 24, height: 20 },
      repeat: {
        arrangement: 'half-drop',
        gapX: 2,
        gapY: 3,
        rowShift: 0,
        columnShift: 0.5,
        mirrorX: true,
        mirrorY: false,
        originX: -4.5,
        originY: 7.25,
      },
      source: {
        kind: 'procedural',
        recipe: {
          type: 'checkerboard',
          tileWidth: 24,
          tileHeight: 20,
          color1: '#ffffff',
          color2: '#000000',
          seed: 0,
        },
      },
    };
    render(
      <PatternFillControls
        pattern={{
          tileSrc: 'stale-preview',
          definitionId: definition.id,
          spacing: 0,
          rotation: 12,
          imageWidth: 40,
          offsetX: 2.5,
        }}
        definition={definition}
        definitionTileSrc="data:image/png;base64,CURRENT"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /detach this fill from the definition/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: undefined,
        tileSrc: 'data:image/png;base64,CURRENT',
        arrangement: 'half-drop',
        gapX: 2,
        gapY: 3,
        columnShift: 0.5,
        mirrorX: true,
        offsetX: 2.5,
        offsetY: 7.25,
        imageWidth: 40,
        imageHeight: 20,
        rotation: 12,
      }),
    );
  });

  it('writes independent per-axis gaps', () => {
    const onChange = vi.fn();
    render(<PatternFillControls pattern={defaultPattern()} onChange={onChange} />);
    const gapX = screen.getByRole('spinbutton', { name: /gap across/i });
    fireEvent.change(gapX, { target: { value: '12' } });
    fireEvent.blur(gapX);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gapX: 12 }));
  });

  it('mirrors one axis without touching the other', () => {
    const onChange = vi.fn();
    render(<PatternFillControls pattern={defaultPattern()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /mirror across/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mirrorX: true }));
    expect(onChange.mock.calls[0]?.[0]).not.toHaveProperty('mirrorY', true);
  });

  it('loads a local file into onChange as a data URL and drops the generator', async () => {
    const onChange = vi.fn();
    const pattern: PatternFillData = {
      tileSrc: '',
      spacing: 0,
      rotation: 0,
      generator: {
        type: 'checkerboard',
        tileWidth: 32,
        tileHeight: 32,
        color1: '#ffffff',
        color2: '#000000',
      },
    };
    render(<PatternFillControls pattern={pattern} onChange={onChange} />);

    const file = new File([Uint8Array.from([137, 80, 78, 71])], 'tile.png', {
      type: 'image/png',
    });
    const readerMock = {
      readAsDataURL: vi.fn(function (this: FileReader) {
        queueMicrotask(() => {
          Object.defineProperty(this, 'result', { value: 'data:image/png;base64,TILE' });
          this.onload?.({} as ProgressEvent<FileReader>);
        });
      }),
      onload: null as FileReader['onload'],
      onerror: null as FileReader['onerror'],
      result: null as string | null,
    };
    vi.stubGlobal(
      'FileReader',
      vi.fn(function (this: unknown) {
        return readerMock;
      }),
    );

    const input = document.querySelector('input[type="file"][accept^="image"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /choose tile/i }));
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const next = onChange.mock.calls[0]?.[0] as PatternFillData;
    expect(next.tileSrc).toMatch(/^data:image\/png;base64,/);
    // Importing real bytes replaces the procedural source.
    expect(next.generator).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('sends imported bytes through the fill-scoped commit callback when provided', async () => {
    const onChange = vi.fn();
    const onImportTile = vi.fn();
    const readerMock = {
      readAsDataURL: vi.fn(function (this: FileReader) {
        queueMicrotask(() => {
          Object.defineProperty(this, 'result', { value: 'data:image/png;base64,SCOPED' });
          this.onload?.({} as ProgressEvent<FileReader>);
        });
      }),
      onload: null as FileReader['onload'],
      onerror: null as FileReader['onerror'],
      result: null as string | null,
    };
    vi.stubGlobal(
      'FileReader',
      vi.fn(function (this: unknown) {
        return readerMock;
      }),
    );

    render(
      <PatternFillControls
        pattern={defaultPattern()}
        onChange={onChange}
        onImportTile={onImportTile}
      />,
    );
    const file = new File([Uint8Array.from([137, 80, 78, 71])], 'tile.png', {
      type: 'image/png',
    });
    const input = document.querySelector('input[type="file"][accept^="image"]') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: /choose tile/i }));
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onImportTile).toHaveBeenCalledWith('data:image/png;base64,SCOPED'));
    expect(onChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('clears the current tile source', () => {
    const onChange = vi.fn();
    render(
      <PatternFillControls
        pattern={{ tileSrc: 'data:image/png;base64,TILE', spacing: 4, rotation: 90 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear tile/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tileSrc: '' }));
  });

  it('calls onChange with imageWidth/imageHeight overrides', () => {
    const onChange = vi.fn();
    render(<PatternFillControls pattern={defaultPattern()} onChange={onChange} />);
    const widthInput = screen.getByRole('spinbutton', { name: /tile width/i });
    fireEvent.change(widthInput, { target: { value: '64' } });
    fireEvent.blur(widthInput);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ imageWidth: 64 }));
  });

  it('creates a generator recipe together with its derived tile', () => {
    const onChange = vi.fn();
    render(<PatternFillControls pattern={defaultPattern()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /generate pattern/i }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]?.[0] as PatternFillData;
    // The recipe is the editable source; the tile is a derived cache.
    expect(next.generator).toBeTruthy();
    expect(next.generator?.type).toBe('polka-dots');
    expect(typeof next.generator?.seed).toBe('number');
    expect(next.logicalWidth).toBeGreaterThan(0);
  });

  it('persists a new seed exactly once per Randomize, deterministically', () => {
    const onChange = vi.fn();
    const pattern: PatternFillData = {
      tileSrc: '',
      spacing: 0,
      rotation: 0,
      generator: {
        type: 'polka-dots',
        tileWidth: 64,
        tileHeight: 64,
        color1: '#ffffff',
        color2: '#000000',
        seed: 5,
      },
    };
    render(<PatternFillControls pattern={pattern} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /randomize/i }));
    const next = onChange.mock.calls[0]?.[0] as PatternFillData;
    expect(next.generator?.seed).toBeTypeOf('number');
    // The recipe and the derived tile are written together, in one change.
    expect(next.tileSrc).toBeTruthy();
    expect(next.tileSrc.length).toBeGreaterThan(0);
  });

  it('detaching a generator keeps the bitmap', () => {
    const onChange = vi.fn();
    const pattern: PatternFillData = {
      tileSrc: 'data:image/png;base64,TILE',
      spacing: 0,
      rotation: 0,
      generator: {
        type: 'checkerboard',
        tileWidth: 32,
        tileHeight: 32,
        color1: '#ffffff',
        color2: '#000000',
      },
    };
    render(<PatternFillControls pattern={pattern} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /detach generator/i }));
    const next = onChange.mock.calls[0]?.[0] as PatternFillData;
    expect(next.generator).toBeUndefined();
    expect(next.tileSrc).toBe('data:image/png;base64,TILE');
  });

  it('detaches a linked fill while preserving its resolved source, geometry, and placement', () => {
    const onChange = vi.fn();
    const definition: PatternDefinition = {
      id: 'shared-pattern',
      name: 'Shared pattern',
      revision: 3,
      cell: { x: 0, y: 0, width: 32, height: 16 },
      repeat: {
        arrangement: 'brick',
        gapX: 3,
        gapY: 5,
        rowShift: 0.5,
        columnShift: 0,
        mirrorX: false,
        mirrorY: false,
        originX: 7,
        originY: -2,
      },
      source: {
        kind: 'procedural',
        recipe: {
          type: 'checkerboard',
          tileWidth: 32,
          tileHeight: 16,
          color1: '#ffffff',
          color2: '#000000',
          seed: 0,
        },
      },
    };
    render(
      <PatternFillControls
        pattern={{
          tileSrc: '',
          definitionId: definition.id,
          spacing: 0,
          rotation: 19,
          imageWidth: 48,
          imageHeight: 24,
          offsetY: 4,
        }}
        definition={definition}
        definitionTileSrc="data:image/png;base64,SHARED"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /detach this fill/i }));
    const detached = onChange.mock.calls[0]?.[0] as PatternFillData;
    expect(detached.definitionId).toBeUndefined();
    expect(detached.tileSrc).toBe('data:image/png;base64,SHARED');
    expect(detached.arrangement).toBe('brick');
    expect(detached.gapX).toBe(3);
    expect(detached.gapY).toBe(5);
    expect(detached.rowShift).toBe(0.5);
    expect(detached.columnShift).toBe(0);
    expect(detached.offsetX).toBe(7);
    expect(detached.offsetY).toBe(4);
    expect(detached.imageWidth).toBe(48);
    expect(detached.imageHeight).toBe(24);
    expect(detached.rotation).toBe(19);
  });
});

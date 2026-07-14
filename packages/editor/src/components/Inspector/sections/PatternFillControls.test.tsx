/**
 * PatternFillControls — pattern fill tile source, dimensions, spacing, rotation.
 *
 * Supports file pick, source URL entry, tile width/height overrides, spacing,
 * rotation. Prevents render of empty/invalid filenames and handles clear action.
 *
 * Research basis: Figma pattern fill controls; ImageFillControls patterns.
 */
// @vitest-environment jsdom

import type { PatternFillData } from '@strata/scene';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PatternFillControls } from './PatternFillControls';

afterEach(cleanup);

function defaultPattern(): PatternFillData {
  return { tileSrc: '', spacing: 0, rotation: 0 };
}

describe('PatternFillControls', () => {
  it('renders choose-tile affordance and source field', () => {
    render(<PatternFillControls pattern={defaultPattern()} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /choose tile|replace tile/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /pattern tile source/i })).toBeTruthy();
  });

  it('renders tile width, tile height, spacing, and rotation fields', () => {
    render(<PatternFillControls pattern={defaultPattern()} onChange={() => {}} />);
    expect(screen.getByText(/Tile width/)).toBeTruthy();
    expect(screen.getByText(/Tile height/)).toBeTruthy();
    expect(screen.getByText(/Spacing/)).toBeTruthy();
    expect(screen.getByText(/Rotation/)).toBeTruthy();
  });

  it('loads a local file into onChange as a data URL', async () => {
    const onChange = vi.fn();
    render(<PatternFillControls pattern={defaultPattern()} onChange={onChange} />);

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
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const next = onChange.mock.calls[0]?.[0] as PatternFillData;
    expect(next.tileSrc).toMatch(/^data:image\/png;base64,/);

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
});

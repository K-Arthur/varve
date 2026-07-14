/**
 * ImageFillControls — image fill source + fit controls.
 *
 * Supports URL entry and local file pick (data URL). Preview when src is set.
 *
 * Research basis: Figma image fill controls; APG file input patterns.
 */
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageFillControls } from './ImageFillControls';

afterEach(cleanup);

describe('ImageFillControls', () => {
  it('renders choose-image affordance and fit control', () => {
    render(
      <ImageFillControls
        image={{ src: '', fit: 'fill', x: 0, y: 0, scale: 1 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /choose image|replace image/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /image fit/i })).toBeTruthy();
  });

  it('loads a local file into onChange as a data URL', async () => {
    const onChange = vi.fn();
    render(
      <ImageFillControls
        image={{ src: '', fit: 'fill', x: 0, y: 0, scale: 1 }}
        onChange={onChange}
      />,
    );

    const file = new File([Uint8Array.from([137, 80, 78, 71])], 'swatch.png', {
      type: 'image/png',
    });
    // Patch FileReader for jsdom
    const readerMock = {
      readAsDataURL: vi.fn(function (this: FileReader) {
        queueMicrotask(() => {
          Object.defineProperty(this, 'result', { value: 'data:image/png;base64,AAAA' });
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

    const input = document.querySelector(
      'input[type="file"][accept^="image"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const next = onChange.mock.calls[0]?.[0] as { src: string };
    expect(next.src).toMatch(/^data:image\/png;base64,/);

    vi.unstubAllGlobals();
  });

  it('clears the current image source', () => {
    const onChange = vi.fn();
    render(
      <ImageFillControls
        image={{ src: 'data:image/png;base64,AAAA', fit: 'fit', x: 0, y: 0, scale: 1 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear image/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ src: '', fit: 'fit' }),
    );
  });
});

/**
 * ImageFillControls — image fill source + fit controls.
 *
 * Supports URL entry and local file pick (data URL). Preview when src is set.
 *
 * Research basis: Figma image fill controls; APG file input patterns.
 */
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEmbeddedAsset } from '@varve/scene';
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

  it('uses embedded asset bytes when a canonical reference reaches the inspector', () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const asset = createEmbeddedAsset({
      dataUrl,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 10,
    });
    render(
      <ImageFillControls
        image={{ src: `asset:${asset.id}`, assetId: asset.id, fit: 'fill', x: 0, y: 0, scale: 1 }}
        asset={asset}
        onChange={() => {}}
      />,
    );

    expect(document.querySelector('.insp-image-fill__preview img')).toHaveAttribute('src', dataUrl);
  });

  it('does not expose an unresolved asset reference as an image URL', () => {
    render(
      <ImageFillControls
        image={{
          src: 'asset:asset-missing',
          assetId: 'asset-missing',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
        }}
        onChange={() => {}}
      />,
    );

    expect(document.querySelector('.insp-image-fill__preview img')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/data is unavailable/i);
    expect(screen.getByRole('button', { name: /replace image/i })).toBeTruthy();
  });

  it('renders image colour metadata as separated label/value rows', () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const asset = createEmbeddedAsset({
      dataUrl,
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 10,
      metadata: {
        colorEncoding: {
          model: 'rgb',
          primaries: 'unknown',
          transfer: 'unknown',
          bitDepth: 8,
          provenance: 'format-default',
        },
      },
    });

    render(
      <ImageFillControls
        image={{ src: `asset:${asset.id}`, assetId: asset.id, fit: 'fill', x: 0, y: 0, scale: 1 }}
        asset={asset}
        onChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /show colour details/i }));
    const details = document.querySelector('.insp-image-fill__color-details');
    expect(details).toBeTruthy();
    expect(details?.querySelectorAll('.insp-image-fill__color-detail')).toHaveLength(4);
    expect(details?.querySelector('.insp-image-fill__color-detail dt')).toHaveTextContent(
      'Profile source',
    );
    expect(details?.querySelector('.insp-image-fill__color-detail dd')).toHaveTextContent(
      'format default',
    );
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

    const input = document.querySelector('input[type="file"][accept^="image"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const next = onChange.mock.calls[0]?.[0] as { src: string };
    expect(next.src).toMatch(/^data:image\/png;base64,/);

    vi.unstubAllGlobals();
  });

  it('clears the current image source and its assetId', () => {
    const onChange = vi.fn();
    render(
      <ImageFillControls
        image={{
          src: 'data:image/png;base64,AAAA',
          assetId: 'asset-old',
          fit: 'fit',
          x: 0,
          y: 0,
          scale: 1,
        }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear image/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ src: '', fit: 'fit', assetId: undefined }),
    );
  });

  it('drops a stale assetId when the source URL is edited by hand', () => {
    const onChange = vi.fn();
    render(
      <ImageFillControls
        image={{
          src: 'data:image/png;base64,AAAA',
          assetId: 'asset-old',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/image source url/i), {
      target: { value: 'https://example.com/new.png' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ src: 'https://example.com/new.png', assetId: undefined }),
    );
  });

  it('registers a new file as an embedded asset with decoded dimensions', async () => {
    const onChange = vi.fn();
    const registerAsset = vi.fn((input: { dataUrl: string }) => `asset-${input.dataUrl.length}`);
    render(
      <ImageFillControls
        image={{ src: '', fit: 'fill', x: 0, y: 0, scale: 1 }}
        onChange={onChange}
        registerAsset={registerAsset}
      />,
    );

    const file = new File([Uint8Array.from([137, 80, 78, 71])], 'photo.png', {
      type: 'image/png',
    });
    const readerMock = {
      readAsDataURL: vi.fn(function (this: FileReader) {
        queueMicrotask(() => {
          Object.defineProperty(this, 'result', { value: 'data:image/png;base64,BBBB' });
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
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 42;
      naturalHeight = 24;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);

    const input = document.querySelector('input[type="file"][accept^="image"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(registerAsset).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,BBBB',
      mimeType: 'image/png',
      naturalWidth: 42,
      naturalHeight: 24,
    });
    const next = onChange.mock.calls[0]?.[0] as ImageFillDataLike;
    expect(next.assetId).toBe('asset-26');
    expect(next.imageWidth).toBe(42);
    expect(next.imageHeight).toBe(24);

    vi.unstubAllGlobals();
  });
});

interface ImageFillDataLike {
  src: string;
  assetId?: string;
  imageWidth?: number;
  imageHeight?: number;
}

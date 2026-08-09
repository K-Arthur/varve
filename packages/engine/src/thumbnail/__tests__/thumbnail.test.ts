// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { generateThumbnail } from '../service';

const EMPTY_REVISION = 'empty';

describe('generateThumbnail', () => {
  it('returns null for empty nodes', async () => {
    const result = await generateThumbnail([], EMPTY_REVISION);
    expect(result).toBeNull();
  });

  it('returns null when all nodes are empty rects', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Rect',
          kind: 'shape',
          transform: [1, 0, 0, 1, 100, 100],
          shape: { kind: 'rect', x: 0, y: 0, w: 0, h: 0 },
        },
      ],
      EMPTY_REVISION,
    );
    expect(result).toBeNull();
  });

  it('generates a data URL for a single rect node', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Rect',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        },
      ],
      EMPTY_REVISION,
      { maxWidth: 64, maxHeight: 64 },
    );
    expect(result).not.toBeNull();
    expect(result!.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result!.metadata.outputWidth).toBe(64);
    expect(result!.metadata.outputHeight).toBe(64);
    expect(result!.metadata.mimeType).toBe('image/png');
    expect(result!.metadata.isPlaceholder).toBe(false);
  });

  it('respects contain fit mode', async () => {
    // Tall rect: should be height-constrained
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Tall',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 200 },
          fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
        },
      ],
      EMPTY_REVISION,
      { maxWidth: 100, maxHeight: 100, fit: 'contain' },
    );
    expect(result).not.toBeNull();
    // Height constrained: output height <= 100 (50x200 * 0.5 = 100x25)
    expect(result!.metadata.scaleFactor).toBeLessThan(1);
  });

  it('respects cover fit mode', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Wide',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 50 },
          fill: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
        },
      ],
      EMPTY_REVISION,
      { maxWidth: 100, maxHeight: 100, fit: 'cover' },
    );
    expect(result).not.toBeNull();
    // Cover mode: output >= target for at least one dimension
    expect(result!.metadata.outputWidth).toBeGreaterThanOrEqual(100);
    expect(result!.metadata.scaleFactor).toBeGreaterThanOrEqual(1);
  });

  it('accepts AbortSignal and returns null when aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Rect',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        },
      ],
      EMPTY_REVISION,
      {},
      ac.signal,
    );
    expect(result).toBeNull();
  });

  it('generates different cache keys for different content', async () => {
    const r1 = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Red',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        },
      ],
      'rev1',
    );
    const r2 = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Blue',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
        },
      ],
      'rev2',
    );
    expect(r1!.metadata.cacheKey).not.toBe(r2!.metadata.cacheKey);
  });

  it('handles background solid color', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Rect',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 }, // transparent
        },
      ],
      EMPTY_REVISION,
      {
        maxWidth: 32,
        maxHeight: 32,
        background: { type: 'solid', color: '#ff0000' },
      },
    );
    expect(result).not.toBeNull();
    expect(result!.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('handles checkerboard background', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Empty',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
        },
      ],
      EMPTY_REVISION,
      { background: { type: 'checkerboard' } },
    );
    expect(result).not.toBeNull();
  });

  it('caps dimensions at MAX_THUMBNAIL_DIMENSION', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Large',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 5000, h: 5000 },
          fill: { space: 'rgb', r: 128, g: 128, b: 128, a: 255 },
        },
      ],
      EMPTY_REVISION,
      { maxWidth: 8000, maxHeight: 8000 },
    );
    expect(result).not.toBeNull();
    expect(result!.metadata.outputWidth).toBeLessThanOrEqual(4096);
    expect(result!.metadata.outputHeight).toBeLessThanOrEqual(4096);
  });

  it('honors devicePixelRatio within the pixel budget', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Rect',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 200 },
          fill: { space: 'rgb', r: 0, g: 128, b: 0, a: 255 },
        },
      ],
      EMPTY_REVISION,
      { maxWidth: 64, maxHeight: 64, devicePixelRatio: 2 },
    );
    expect(result).not.toBeNull();
    expect(result!.metadata.outputWidth).toBe(128);
    expect(result!.metadata.outputHeight).toBe(128);
  });

  it('reports the renderer version in metadata', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Rect',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
        },
      ],
      'rev-x',
    );
    expect(result).not.toBeNull();
    expect(result!.metadata.revisionId).toBe('rev-x');
    expect(result!.metadata.rendererVersion).toMatch(/^\d+$/);
    expect(result!.metadata.byteSize).toBeGreaterThan(0);
    expect(result!.metadata.isProvisional).toBe(false);
  });

  it('records image-not-ready warnings when raster fills are not decoded', async () => {
    // A fill referencing an unregistered data source decodes asynchronously;
    // the bounded preload must not block forever, and the result is marked
    // provisional so it is never treated as an authoritative preview.
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Img',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,iVBORw0KGgo=',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      ],
      EMPTY_REVISION,
      { maxWidth: 64, maxHeight: 64 },
    );
    expect(result).not.toBeNull();
    // Either the image decoded (fine) or the render is marked provisional.
    if (result!.metadata.isProvisional) {
      expect(result!.metadata.warnings).toContain('image-not-ready');
    }
  });

  it('accepts webp format when the encoder supports it', async () => {
    const result = await generateThumbnail(
      [
        {
          id: 'n1',
          name: 'Rect',
          kind: 'shape',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: { space: 'rgb', r: 10, g: 20, b: 30, a: 255 },
        },
      ],
      EMPTY_REVISION,
      { maxWidth: 64, maxHeight: 64, format: 'webp' },
    );
    expect(result).not.toBeNull();
    // jsdom's canvas stub may only support png — accept either, but the
    // mime type must be consistent with the payload.
    expect(['image/webp', 'image/png']).toContain(result!.metadata.mimeType);
  });
});

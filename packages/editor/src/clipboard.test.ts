import type { DocumentAsset, RasterMaskAsset, SceneNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { readFromClipboardEvent, writeClipboard } from './clipboard';

// jsdom doesn't implement ClipboardEvent, DataTransfer, or Blob.arrayBuffer.
// Polyfill what we need for testing.
if (typeof Blob !== 'undefined') {
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = async function () {
      const reader = new FileReader();
      return new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
  if (!Blob.prototype.text) {
    Blob.prototype.text = async function () {
      const buffer = await this.arrayBuffer();
      return new TextDecoder().decode(buffer);
    };
  }
}

function createFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator](): Iterator<File> {
      let i = 0;
      return {
        next: (): IteratorResult<File> => {
          if (i >= files.length) return { done: true, value: undefined as unknown as File };
          const file = files[i] as File;
          i++;
          return { done: false, value: file };
        },
      };
    },
  } as unknown as FileList;
}

function createDataTransferWithFiles(files: File[]): DataTransfer {
  const fileList = createFileList(files);
  return {
    files: fileList,
    items: files.map((f) => ({
      kind: 'file',
      type: f.type,
      getAsFile: () => f,
    })) as unknown as DataTransferItemList,
    getData: () => '',
    setData: () => {},
    clearData: () => {},
    types: [] as ReadonlyArray<string>,
    effectAllowed: 'none',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function createClipboardEventWithFiles(files: File[]): ClipboardEvent {
  const dt = createDataTransferWithFiles(files);
  return {
    type: 'paste',
    clipboardData: dt,
    defaultPrevented: false,
    preventDefault: () => {},
    stopPropagation: () => {},
    bubbles: true,
    cancelable: true,
  } as ClipboardEvent;
}

describe('readFromClipboardEvent', () => {
  it('extracts image files from clipboardData.files', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const file = new File([pngBytes], 'image.png', { type: 'image/png' });
    const event = createClipboardEventWithFiles([file]);

    const result = await readFromClipboardEvent(event);
    expect(result.importItems).toHaveLength(1);
    expect(result.importItems[0]?.mimeType).toBe('image/png');
    expect(result.importItems[0]?.name).toBe('image.png');
    const data = result.importItems[0]?.data as Uint8Array;
    expect(new Uint8Array(data)).toEqual(pngBytes);
  });

  it('extracts SVG text from clipboardData', async () => {
    const svgContent =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const file = new File([svgContent], 'clipboard.svg', { type: 'image/svg+xml' });
    const event = createClipboardEventWithFiles([file]);

    const result = await readFromClipboardEvent(event);
    const svgItem = result.importItems.find((i) => i.mimeType === 'image/svg+xml');
    expect(svgItem).toBeDefined();
    expect(svgItem?.data).toBe(svgContent);
  });

  it('returns empty when clipboardData is null', async () => {
    const event = { type: 'paste', clipboardData: null } as unknown as ClipboardEvent;
    const result = await readFromClipboardEvent(event);
    expect(result.varveData).toBeNull();
    expect(result.importItems).toHaveLength(0);
  });

  it('handles multiple files in one paste', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const jpegBytes = new Uint8Array([255, 216, 255, 224]);
    const svgContent = '<svg><circle cx="5" cy="5" r="4"/></svg>';
    const files = [
      new File([pngBytes], 'a.png', { type: 'image/png' }),
      new File([jpegBytes], 'b.jpg', { type: 'image/jpeg' }),
      new File([svgContent], 'c.svg', { type: 'image/svg+xml' }),
    ];
    const event = createClipboardEventWithFiles(files);

    const result = await readFromClipboardEvent(event);
    expect(result.importItems).toHaveLength(3);
  });

  it('skips non-image files', async () => {
    const file = new File(['hello'], 'readme.txt', { type: 'text/plain' });
    const event = createClipboardEventWithFiles([file]);

    const result = await readFromClipboardEvent(event);
    expect(result.importItems).toHaveLength(0);
  });

  it('reads Varve JSON from clipboardData.getData', async () => {
    const strataJson = JSON.stringify({
      nodes: [{ id: 'n1', kind: 'shape', shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 } }],
    });
    const file = new File([strataJson], 'data.strata', { type: 'application/vnd.strata+json' });
    const dt = createDataTransferWithFiles([file]);
    dt.getData = (format: string) => {
      if (format === 'application/vnd.strata+json') return strataJson;
      return '';
    };
    const event = { type: 'paste', clipboardData: dt } as unknown as ClipboardEvent;

    const result = await readFromClipboardEvent(event);
    expect(result.varveData).not.toBeNull();
    expect(result.varveData?.nodes).toHaveLength(1);
    expect(result.varveData?.nodes[0]?.id).toBe('n1');
  });

  it('reads clipboard data including raster mask assets', async () => {
    const varveData = {
      nodes: [
        {
          id: 'img-1',
          kind: 'shape',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
          name: 'Image 1',
        },
      ],
      rasterMaskAssets: {
        'mask-img-1': {
          id: 'mask-img-1',
          mimeType: 'image/png',
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          width: 1,
          height: 1,
          byteLength: 68,
        },
      },
    };
    const strataJson = JSON.stringify(varveData);
    const file = new File([strataJson], 'data.strata', { type: 'application/vnd.strata+json' });
    const dt = createDataTransferWithFiles([file]);
    dt.getData = (format: string) => {
      if (format === 'application/vnd.strata+json') return strataJson;
      return '';
    };
    const event = { type: 'paste', clipboardData: dt } as unknown as ClipboardEvent;

    const result = await readFromClipboardEvent(event);
    expect(result.varveData).not.toBeNull();
    expect(result.varveData?.rasterMaskAssets).toBeDefined();
    expect(result.varveData?.rasterMaskAssets?.['mask-img-1']).toBeDefined();
    expect(result.varveData?.rasterMaskAssets?.['mask-img-1']?.mimeType).toBe('image/png');
  });

  it('round-trips cropped image geometry with image and raster-mask asset closure', async () => {
    const imageAsset: DocumentAsset = {
      id: 'asset-image-1',
      storage: 'embedded',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      naturalWidth: 200,
      naturalHeight: 100,
      byteLength: 5,
      hash: 'image-hash',
    };
    const maskAsset: RasterMaskAsset = {
      id: 'mask-image-1',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,bWFzaw==',
      width: 200,
      height: 100,
      byteLength: 4,
    };
    const node = {
      id: 'image-1',
      kind: 'shape',
      name: 'Cropped image',
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      fills: [
        {
          type: 'image',
          image: {
            src: imageAsset.dataUrl,
            assetId: imageAsset.id,
            fit: 'crop',
            x: -12,
            y: 8,
            scale: 1.5,
            imageWidth: 200,
            imageHeight: 100,
            crop: { x: 20, y: 10, w: 120, h: 70 },
            rotation: 15,
            flipH: true,
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      strokes: [],
      effects: [],
      filters: [],
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      locked: false,
      rotation: 0,
      mask: {
        type: 'alpha',
        visible: true,
        rasterMask: {
          assetId: maskAsset.id,
          coordinateSpace: 'source-image-pixels',
          sourceIdentity: {
            kind: 'source-metadata',
            locator: imageAsset.id,
            pixelWidth: 200,
            pixelHeight: 100,
            revision: 1,
          },
        },
      },
    } as unknown as SceneNode;
    const strataJson = JSON.stringify({
      nodes: [node],
      assets: { [imageAsset.id]: imageAsset },
      rasterMaskAssets: { [maskAsset.id]: maskAsset },
    });
    const dt = createDataTransferWithFiles([]);
    dt.getData = (format: string) => (format === 'application/vnd.strata+json' ? strataJson : '');
    const event = { type: 'paste', clipboardData: dt } as unknown as ClipboardEvent;

    const result = await readFromClipboardEvent(event);

    expect(result.varveData).toEqual(JSON.parse(strataJson));
    const image = result.varveData?.nodes[0]?.fills?.[0]?.image;
    expect(image?.crop).toEqual({ x: 20, y: 10, w: 120, h: 70 });
    expect(result.varveData?.assets?.[imageAsset.id]).toEqual(imageAsset);
    expect(result.varveData?.rasterMaskAssets?.[maskAsset.id]).toEqual(maskAsset);
  });

  it('writes image and raster-mask assets into the Varve clipboard payload', async () => {
    const node = {
      id: 'image-1',
      name: 'Image',
      kind: 'shape',
    } as unknown as SceneNode;
    const imageAsset = {
      id: 'asset-image-1',
      storage: 'embedded',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      naturalWidth: 1,
      naturalHeight: 1,
      byteLength: 5,
      hash: 'hash',
    } satisfies DocumentAsset;
    const maskAsset = {
      id: 'mask-image-1',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,bWFzaw==',
      width: 1,
      height: 1,
      byteLength: 4,
    } satisfies RasterMaskAsset;
    let written:
      | Array<{ getType: (type: string) => Promise<Blob>; types: readonly string[] }>
      | undefined;
    class TestClipboardItem {
      readonly types: string[];
      constructor(private readonly entries: Record<string, Blob>) {
        this.types = Object.keys(entries);
      }
      async getType(type: string): Promise<Blob> {
        return this.entries[type]!;
      }
    }
    const originalClipboardItem = globalThis.ClipboardItem;
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn(async (items) => {
          written = items;
        }),
        writeText: vi.fn(),
      },
    });

    try {
      await expect(
        writeClipboard([node], { [maskAsset.id]: maskAsset }, { [imageAsset.id]: imageAsset }),
      ).resolves.toBe(true);
      // The primary write uses Chromium's `web `-prefixed custom formats;
      // the unprefixed pair is the fallback for engines that reject those.
      const strataBlob = await written?.[0]?.getType('web application/vnd.strata+json');
      expect(strataBlob).toBeDefined();
      const payload = JSON.parse(await strataBlob!.text());
      expect(payload.assets).toEqual({ [imageAsset.id]: imageAsset });
      expect(payload.rasterMaskAssets).toEqual({ [maskAsset.id]: maskAsset });
    } finally {
      Object.defineProperty(globalThis, 'ClipboardItem', {
        configurable: true,
        value: originalClipboardItem,
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('serializes the world anchor for paste world-pose preservation', async () => {
    const node = {
      id: 'child-1',
      name: 'Child',
      kind: 'shape',
      transform: [1, 0, 0, 1, 40, 60],
    } as unknown as SceneNode;
    const anchor: Record<string, Affine> = { 'child-1': [1, 0, 0, 1, 1640, 80] };
    let written:
      | Array<{ getType: (type: string) => Promise<Blob>; types: readonly string[] }>
      | undefined;
    class TestClipboardItem {
      readonly types: string[];
      constructor(private readonly entries: Record<string, Blob>) {
        this.types = Object.keys(entries);
      }
      async getType(type: string): Promise<Blob> {
        return this.entries[type]!;
      }
    }
    const originalClipboardItem = globalThis.ClipboardItem;
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn(async (items) => {
          written = items;
        }),
        writeText: vi.fn(),
      },
    });

    try {
      await expect(writeClipboard([node], undefined, undefined, undefined, anchor)).resolves.toBe(
        true,
      );
      const blob = await written?.[0]?.getType('web application/vnd.varve+json');
      expect(blob).toBeDefined();
      const payload = JSON.parse(await blob!.text());
      expect(payload.worldAnchor).toEqual(anchor);
    } finally {
      Object.defineProperty(globalThis, 'ClipboardItem', {
        configurable: true,
        value: originalClipboardItem,
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });
});

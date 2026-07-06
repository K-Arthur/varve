import { describe, expect, it } from 'vitest';
import { readFromClipboardEvent } from './clipboard';

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
          return { done: false, value: files[i] as File };
          i++;
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
    expect(result.importItems[0]!.mimeType).toBe('image/png');
    expect(result.importItems[0]!.name).toBe('image.png');
    const data = result.importItems[0]!.data as Uint8Array;
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
    expect(svgItem!.data).toBe(svgContent);
  });

  it('returns empty when clipboardData is null', async () => {
    const event = { type: 'paste', clipboardData: null } as unknown as ClipboardEvent;
    const result = await readFromClipboardEvent(event);
    expect(result.strataData).toBeNull();
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

  it('reads Strata JSON from clipboardData.getData', async () => {
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
    expect(result.strataData).not.toBeNull();
    expect(result.strataData!.nodes).toHaveLength(1);
    expect(result.strataData!.nodes[0]!.id).toBe('n1');
  });
});

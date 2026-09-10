// @vitest-environment jsdom
import { addNode, createDocument, makeImageShapeNode } from '@varve/scene';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commitRasterMask } from './commitRasterMask';
import { prepareExportCutouts } from './prepareExportCutouts';

const mocks = vi.hoisted(() => ({ load: vi.fn(), remove: vi.fn() }));
vi.mock('@varve/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@varve/engine')>()),
  getImageCache: () => ({ load: mocks.load }),
  removeBackground: mocks.remove,
}));
const mask =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
function documentWithImage() {
  return addNode(
    createDocument('Export', true),
    makeImageShapeNode('image', {
      src: 'source',
      w: 10,
      h: 10,
      imageWidth: 1,
      imageHeight: 1,
    }),
  );
}
beforeEach(() => {
  mocks.load.mockResolvedValue({ naturalWidth: 1, naturalHeight: 1 });
  mocks.remove.mockResolvedValue({
    width: 1,
    height: 1,
    maskDataUrl: mask,
    method: 'quick',
    confidence: 0.4,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
  } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it('exports from a native-mask snapshot while leaving the input untouched', async () => {
  const document = documentWithImage();
  const result = await prepareExportCutouts(
    document,
    [document.nodes.image!],
    'quick',
    new AbortController().signal,
  );
  expect(document.nodes.image!.mask).toBeUndefined();
  expect(result.preparedDocument!.nodes.image!.mask!.rasterMask).toBeDefined();
  expect(result.preparedMasks[0]).toMatchObject({
    width: 1,
    height: 1,
    sourceNode: document.nodes.image,
    confidence: 0.4,
  });
  expect(mocks.remove.mock.calls[0]![0]).toMatchObject({ width: 1, height: 1 });
});
it('does not run inference again for an existing native cutout', async () => {
  const document = commitRasterMask(documentWithImage(), 'image', {
    dataUrl: mask,
    width: 1,
    height: 1,
  });
  const result = await prepareExportCutouts(
    document,
    [document.nodes.image!],
    'quick',
    new AbortController().signal,
  );
  expect(result.preparedDocument).toBe(document);
  expect(mocks.remove).not.toHaveBeenCalled();
});
it('cancels after decoding without invoking inference or publishing assets', async () => {
  const document = documentWithImage();
  const controller = new AbortController();
  mocks.load.mockImplementation(async () => {
    controller.abort();
    return { naturalWidth: 1, naturalHeight: 1 };
  });
  await expect(
    prepareExportCutouts(document, [document.nodes.image!], 'quick', controller.signal),
  ).rejects.toThrow('cancelled');
  expect(mocks.remove).not.toHaveBeenCalled();
});

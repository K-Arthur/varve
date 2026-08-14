// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDecode, mockInvoke, mockListen } = vi.hoisted(() => ({
  mockDecode: vi.fn(),
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }));
vi.mock('../maskDecode', () => ({ decodeMaskDataUrl: mockDecode }));

describe('Tauri background-removal provider', () => {
  beforeEach(() => {
    Object.assign(window, { __TAURI__: {} });
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(vi.fn());
    mockDecode.mockReset().mockResolvedValue({ mask: new Uint8Array([255]), width: 1, height: 1 });
    const fakeContext = { putImageData: vi.fn() };
    const fakeBlob = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as Blob;
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => fakeContext,
      toBlob: (callback: (blob: Blob) => void) => callback(fakeBlob),
    } as unknown as HTMLCanvasElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, '__TAURI__');
  });

  it('requires both a ready native runtime and the requested model', async () => {
    mockInvoke.mockResolvedValue({ runtimeReady: true, installed: false, sizeBytes: 0 });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');

    await expect(tauriRemovalProvider.isAvailable({ method: 'ai-quality' })).resolves.toBe(false);

    mockInvoke.mockResolvedValue({ runtimeReady: true, installed: true, sizeBytes: 224_005_088 });
    await expect(tauriRemovalProvider.isAvailable({ method: 'ai-quality' })).resolves.toBe(true);
  });

  it('returns a source-reconstructable raw mask and native backend telemetry', async () => {
    mockInvoke.mockResolvedValue({
      maskBase64: 'test',
      confidence: 0.98,
      method: 'ai-quality',
      processingTimeMs: 123,
      width: 1,
      height: 1,
    });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    const result = await tauriRemovalProvider.remove(
      new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1),
      { method: 'ai-quality' },
    );

    expect(result.executionProvider).toBe('native');
    expect(result.rawMask).toEqual(new Uint8Array([255]));
    expect(result.method).toBe('ai-quality');
  });

  it('defaults native decontamination to false to match worker/direct providers', async () => {
    mockInvoke.mockResolvedValue({
      maskBase64: 'test',
      confidence: 0.9,
      method: 'ai-quality',
      processingTimeMs: 10,
      width: 1,
      height: 1,
    });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    await tauriRemovalProvider.remove(new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1), {
      method: 'ai-quality',
    });
    const args = mockInvoke.mock.calls.find(
      ([command]) => command === 'remove_background',
    )?.[1] as { options: { decontaminate: boolean } };
    expect(args.options.decontaminate).toBe(false);

    await tauriRemovalProvider.remove(new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1), {
      method: 'ai-quality',
      decontaminate: true,
    });
    const explicit = mockInvoke.mock.calls.filter(
      ([command]) => command === 'remove_background',
    ) as Array<[string, { options: { decontaminate: boolean } }]>;
    expect(explicit.at(-1)?.[1].options.decontaminate).toBe(true);
  });

  it('forwards native download progress and uses the fixed model-id command', async () => {
    let progressHandler: ((event: { payload: unknown }) => void) | undefined;
    mockListen.mockImplementation(
      async (_event: string, handler: (event: { payload: unknown }) => void) => {
        progressHandler = handler;
        return vi.fn();
      },
    );
    mockInvoke.mockImplementation(async (command: string, args: Record<string, string>) => {
      if (command === 'download_background_removal_model') {
        progressHandler?.({
          payload: {
            requestId: args.requestId,
            modelId: args.modelId,
            loaded: 50,
            total: 100,
          },
        });
        return 100;
      }
      return undefined;
    });
    const progress = vi.fn();
    const { downloadNativeBackgroundRemovalModel } = await import('../providers/tauriProvider');
    await downloadNativeBackgroundRemovalModel('birefnet-general-lite', progress);

    expect(progress).toHaveBeenCalledWith(50, 100);
    expect(mockInvoke).toHaveBeenCalledWith(
      'download_background_removal_model',
      expect.objectContaining({ modelId: 'birefnet-general-lite' }),
    );
  });
});

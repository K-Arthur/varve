import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, listen, isTauri } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@varve/platform', () => ({ isTauriRuntime: isTauri }));

import {
  nativeDeleteInferenceModel,
  nativeDownloadInferenceModel,
  nativeInferenceModelPath,
} from './nativeInferenceModels';

describe('nativeInferenceModels', () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    isTauri.mockReset();
    listen.mockResolvedValue(vi.fn());
  });

  it('does nothing outside Tauri', async () => {
    isTauri.mockReturnValue(false);
    expect(await nativeInferenceModelPath('ddcolor-tiny')).toBeNull();
    expect(await nativeDeleteInferenceModel('ddcolor-tiny')).toBe(false);
    await expect(
      nativeDownloadInferenceModel({
        requestId: 'r1',
        modelId: 'ddcolor-tiny',
        url: 'https://example.com/x.onnx',
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow('desktop');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('resolves an installed native model path', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue('/home/user/.local/share/varve/models/ddcolor-tiny.onnx');
    expect(await nativeInferenceModelPath('ddcolor-tiny')).toBe(
      '/home/user/.local/share/varve/models/ddcolor-tiny.onnx',
    );
    expect(invoke).toHaveBeenCalledWith('inference_model_path', { modelId: 'ddcolor-tiny' });
  });

  it('forwards matching progress events and unlistens', async () => {
    isTauri.mockReturnValue(true);
    const unlisten = vi.fn();
    type ProgressHandler = (event: {
      payload: { requestId: string; modelId: string; loaded: number; total: number };
    }) => void;
    let handler: ProgressHandler | undefined;
    listen.mockImplementation((_event: string, callback: ProgressHandler) => {
      handler = callback;
      return Promise.resolve(unlisten);
    });
    invoke.mockResolvedValue('/models/ddcolor.onnx');
    const onProgress = vi.fn();

    const result = await nativeDownloadInferenceModel({
      requestId: 'req-1',
      modelId: 'ddcolor-tiny',
      url: 'https://github.com/x/y.onnx',
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
      onProgress,
    });

    expect(result).toBe('/models/ddcolor.onnx');
    expect(invoke).toHaveBeenCalledWith('download_inference_model', {
      requestId: 'req-1',
      modelId: 'ddcolor-tiny',
      url: 'https://github.com/x/y.onnx',
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
    });
    handler?.({ payload: { requestId: 'other', modelId: 'x', loaded: 5, total: 10 } });
    expect(onProgress).not.toHaveBeenCalled();
    handler?.({ payload: { requestId: 'req-1', modelId: 'ddcolor-tiny', loaded: 50, total: 100 } });
    expect(onProgress).toHaveBeenCalledWith(50, 100);
    expect(unlisten).toHaveBeenCalled();
  });

  it('cancels a native download after it starts', async () => {
    isTauri.mockReturnValue(true);
    listen.mockResolvedValue(vi.fn());
    let rejectDownload: ((error: Error) => void) | undefined;
    invoke.mockImplementation((command: string) => {
      if (command === 'download_inference_model') {
        return new Promise((_resolve, reject) => {
          rejectDownload = reject;
        });
      }
      return Promise.resolve(undefined);
    });
    const controller = new AbortController();

    const pending = nativeDownloadInferenceModel({
      requestId: 'req-2',
      modelId: 'ddcolor-tiny',
      url: 'https://github.com/x/y.onnx',
      sha256: 'a'.repeat(64),
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'download_inference_model',
        expect.objectContaining({ requestId: 'req-2' }),
      );
    });
    controller.abort();
    expect(invoke).toHaveBeenCalledWith('cancel_inference_model_download', {
      requestId: 'req-2',
    });
    rejectDownload?.(new Error('Download cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('rejects an already-aborted download without starting it', async () => {
    isTauri.mockReturnValue(true);
    const controller = new AbortController();
    controller.abort();
    await expect(
      nativeDownloadInferenceModel({
        requestId: 'req-early',
        modelId: 'ddcolor-tiny',
        url: 'https://github.com/x/y.onnx',
        sha256: 'a'.repeat(64),
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(invoke).not.toHaveBeenCalledWith('download_inference_model', expect.anything());
  });

  it('surfaces native verification failures', async () => {
    isTauri.mockReturnValue(true);
    listen.mockResolvedValue(vi.fn());
    invoke.mockRejectedValue(new Error('Model SHA-256 mismatch'));
    await expect(
      nativeDownloadInferenceModel({
        requestId: 'req-3',
        modelId: 'ddcolor-tiny',
        url: 'https://github.com/x/y.onnx',
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow('SHA-256');
  });
});

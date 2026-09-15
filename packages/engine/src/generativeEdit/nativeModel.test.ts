import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, listen, isTauri } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@varve/platform', () => ({ isTauriRuntime: isTauri }));

import {
  downloadNativeGenerativeModel,
  type NativeGenerativeModelDownloadProgress,
  qualifyNativeGenerativeModel,
} from './nativeModel';

describe('downloadNativeGenerativeModel', () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    isTauri.mockReset();
    isTauri.mockReturnValue(true);
    listen.mockResolvedValue(vi.fn());
  });

  it('rejects an already-aborted request before importing or invoking Tauri APIs', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(downloadNativeGenerativeModel(undefined, controller.signal)).rejects.toThrow(
      'cancelled',
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it('forwards only matching progress events and cleans up the listener', async () => {
    let handler: ((event: { payload: NativeGenerativeModelDownloadProgress }) => void) | undefined;
    const unlisten = vi.fn();
    listen.mockImplementation(
      (
        _event: string,
        callback: (event: { payload: NativeGenerativeModelDownloadProgress }) => void,
      ) => {
        handler = callback;
        return Promise.resolve(unlisten);
      },
    );
    invoke.mockResolvedValue({
      installed: true,
      ready: false,
      downloadAvailable: false,
      qualificationAvailable: false,
      modelHandle: null,
      profileId: 'sd15-inpainting-q4_0-v1',
      checksumSha256: null,
      sizeBytes: 100,
      partialBytes: 0,
      reason: 'validation required',
    });
    const onProgress = vi.fn();

    await expect(downloadNativeGenerativeModel(onProgress)).resolves.toMatchObject({
      installed: true,
    });
    const requestId = invoke.mock.calls.find(
      ([command]) => command === 'download_generative_edit_model',
    )?.[1]?.requestId;
    expect(requestId).toEqual(expect.stringMatching(/^generative-model-/));
    handler?.({ payload: { requestId: 'other', loaded: 1, total: 100 } });
    handler?.({ payload: { requestId, loaded: 25, total: 100 } });
    expect(onProgress).toHaveBeenCalledWith({ requestId, loaded: 25, total: 100 });
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('rejects immediately on abort and still asks native storage to cancel', async () => {
    const controller = new AbortController();
    let resolveDownload!: (status: { installed: boolean }) => void;
    invoke.mockImplementation((command: string) => {
      if (command === 'download_generative_edit_model') {
        return new Promise((resolve) => {
          resolveDownload = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const pending = downloadNativeGenerativeModel(undefined, controller.signal);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'download_generative_edit_model',
        expect.objectContaining({ requestId: expect.stringMatching(/^generative-model-/) }),
      ),
    );

    controller.abort();

    await expect(pending).rejects.toThrow('cancelled');
    expect(invoke).toHaveBeenCalledWith('cancel_generative_edit_model_download', {
      requestId: expect.stringMatching(/^generative-model-/),
    });
    resolveDownload({ installed: true });
  });

  it('does not let a failed native cancel command mask the cancellation result', async () => {
    const controller = new AbortController();
    invoke.mockImplementation((command: string) => {
      if (command === 'download_generative_edit_model') return new Promise(() => {});
      if (command === 'cancel_generative_edit_model_download') {
        return Promise.reject(new Error('native window closed'));
      }
      return Promise.resolve(undefined);
    });

    const pending = downloadNativeGenerativeModel(undefined, controller.signal);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('download_generative_edit_model', expect.anything()),
    );
    controller.abort();

    await expect(pending).rejects.toThrow('cancelled');
  });

  it('cancels qualification by request id and rejects before native work settles', async () => {
    const controller = new AbortController();
    let resolveQualification!: (status: { ready: boolean }) => void;
    invoke.mockImplementation((command: string) => {
      if (command === 'qualify_generative_edit_model') {
        return new Promise((resolve) => {
          resolveQualification = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const pending = qualifyNativeGenerativeModel(controller.signal);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'qualify_generative_edit_model',
        expect.objectContaining({
          requestId: expect.stringMatching(/^generative-qualification-/),
        }),
      ),
    );

    controller.abort();

    await expect(pending).rejects.toThrow('cancelled');
    const qualificationCall = invoke.mock.calls.find(
      ([command]) => command === 'qualify_generative_edit_model',
    );
    expect(invoke).toHaveBeenCalledWith('cancel_generative_edit', {
      requestId: qualificationCall?.[1]?.requestId,
    });
    resolveQualification({ ready: false });
  });

  it('does not start qualification when its signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(qualifyNativeGenerativeModel(controller.signal)).rejects.toThrow('cancelled');
    expect(invoke).not.toHaveBeenCalled();
  });
});

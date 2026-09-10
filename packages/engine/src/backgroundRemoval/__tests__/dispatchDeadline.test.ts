import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers = vi.hoisted(() => ({
  worker: { id: 'worker', isAvailable: vi.fn(), remove: vi.fn() },
  direct: { id: 'direct', isAvailable: vi.fn(), remove: vi.fn() },
  native: { id: 'native', isAvailable: vi.fn(), remove: vi.fn() },
  cloud: { id: 'cloud', isAvailable: vi.fn(), remove: vi.fn() },
  ready: vi.fn(),
}));
vi.mock('../providers/workerProvider', () => ({ workerRemovalProvider: providers.worker }));
vi.mock('../providers/directOnnxProvider', () => ({ directOnnxRemovalProvider: providers.direct }));
vi.mock('../providers/tauriProvider', () => ({
  tauriRemovalProvider: providers.native,
  isNativeAiReady: providers.ready,
}));
vi.mock('../providers/cloudProvider', () => ({ cloudRemovalProvider: providers.cloud }));

import { dispatchBackgroundRemoval } from '../providers/dispatch';

const pending = () => new Promise<never>(() => {});

describe('background removal request budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    providers.ready.mockResolvedValue(false);
    providers.worker.isAvailable.mockResolvedValue(true);
    providers.worker.remove.mockImplementation(pending);
    providers.direct.isAvailable.mockResolvedValue(true);
    providers.direct.remove.mockImplementation(pending);
    providers.native.isAvailable.mockResolvedValue(false);
    providers.cloud.isAvailable.mockResolvedValue(false);
  });
  afterEach(() => vi.useRealTimers());

  it('bounds the entire Auto request and aborts the active attempt', async () => {
    const result = dispatchBackgroundRemoval(new ImageData(2, 2), { method: 'ai-balanced' });
    const rejected = expect(result).rejects.toThrow(/deadline/i);
    await vi.advanceTimersByTimeAsync(125_001);
    await rejected;
    expect(providers.worker.remove.mock.calls[0]?.[2].aborted).toBe(true);
    expect(providers.direct.remove).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a second quality chain after exhausting the request', async () => {
    const result = dispatchBackgroundRemoval(new ImageData(2, 2), { method: 'ai-quality' });
    const rejected = expect(result).rejects.toThrow(/deadline/i);
    await vi.advanceTimersByTimeAsync(310_001);
    await rejected;
    expect(providers.worker.remove).toHaveBeenCalledTimes(1);
    expect(providers.direct.remove).not.toHaveBeenCalled();
  });

  it('bounds native readiness and continues with compatible browser providers', async () => {
    providers.ready.mockImplementation(pending);
    providers.worker.remove.mockResolvedValue({ method: 'ai-balanced' });
    const result = dispatchBackgroundRemoval(new ImageData(2, 2), { method: 'ai-balanced' });
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(result).resolves.toMatchObject({ method: 'ai-balanced' });
  });

  it('cleans deadline timers when cancelled even if the provider never settles', async () => {
    const controller = new AbortController();
    const result = dispatchBackgroundRemoval(
      new ImageData(2, 2),
      { method: 'ai-balanced' },
      controller.signal,
    );
    const rejected = expect(result).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});

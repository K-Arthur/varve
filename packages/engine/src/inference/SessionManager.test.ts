import { describe, expect, it, vi } from 'vitest';
import { SessionManager } from './SessionManager';

type OrtLoader = NonNullable<ConstructorParameters<typeof SessionManager>[1]>;

const fakeOrt = {
  InferenceSession: { create: vi.fn() },
  Tensor: class FakeTensor {},
  env: { wasm: { wasmPaths: '' } },
};

function loaderOf(fn: () => Promise<typeof fakeOrt>): OrtLoader {
  return fn as unknown as OrtLoader;
}

describe('SessionManager runtime loading', () => {
  it('retries the runtime import after a transient failure', async () => {
    const load = vi
      .fn<() => Promise<typeof fakeOrt>>()
      .mockRejectedValueOnce(new Error('transient chunk load failure'))
      .mockResolvedValueOnce(fakeOrt);
    const manager = new SessionManager(3, loaderOf(load));

    await expect(manager.isRuntimeAvailable()).resolves.toBe(false);
    // A rejected import must not be cached for the rest of the session.
    await expect(manager.isRuntimeAvailable()).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches a successful runtime import across calls', async () => {
    const load = vi.fn<() => Promise<typeof fakeOrt>>().mockResolvedValue(fakeOrt);
    const manager = new SessionManager(3, loaderOf(load));

    await expect(manager.isRuntimeAvailable()).resolves.toBe(true);
    await expect(manager.isRuntimeAvailable()).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one import attempt between concurrent callers', async () => {
    let resolveLoad: ((value: typeof fakeOrt) => void) | undefined;
    const load = vi.fn<() => Promise<typeof fakeOrt>>(
      () =>
        new Promise<typeof fakeOrt>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const manager = new SessionManager(3, loaderOf(load));

    const first = manager.isRuntimeAvailable();
    const second = manager.isRuntimeAvailable();
    resolveLoad?.(fakeOrt);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

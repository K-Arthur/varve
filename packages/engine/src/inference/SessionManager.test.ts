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

describe('SessionManager session lifecycle', () => {
  function sessionOf(release: () => Promise<void>) {
    return {
      run: vi.fn(async () => ({})),
      release: vi.fn(release),
      inputNames: ['input'] as const,
      outputNames: ['output'] as const,
    };
  }

  function managerWith(create: (path: string) => Promise<unknown>) {
    const ort = {
      InferenceSession: { create: vi.fn(create) },
      Tensor: class FakeTensor {},
      env: { wasm: { wasmPaths: '' } },
    };
    return new SessionManager(3, (async () => ort) as unknown as OrtLoader);
  }

  it('coalesces concurrent session creation for one path', async () => {
    let releaseCreate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const create = vi.fn(async () => {
      await gate;
      return sessionOf(async () => {});
    });
    const manager = managerWith(create);

    const first = manager.getSession('/m.onnx', 'u2netp');
    const second = manager.getSession('/m.onnx', 'u2netp');
    releaseCreate?.();
    const [a, b] = await Promise.all([first, second]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(manager.size).toBe(1);
  });

  it('removes a session only after its release resolves', async () => {
    let releaseFn: (() => Promise<void>) | undefined;
    const manager = managerWith(async () => sessionOf(() => releaseFn!()));
    await manager.getSession('/m.onnx', 'u2netp');
    let resolved = false;
    releaseFn = async () => {
      await Promise.resolve();
      resolved = true;
    };
    const outcome = await manager.release('/m.onnx');
    expect(resolved).toBe(true);
    expect(outcome.status).toBe('released');
    expect(manager.size).toBe(0);
    await expect(manager.release('/m.onnx')).resolves.toEqual({ status: 'absent' });
  });

  it('keeps and accounts a session whose release failed', async () => {
    const manager = managerWith(async () =>
      sessionOf(async () => {
        throw new Error('device lost');
      }),
    );
    await manager.getSession('/m.onnx', 'u2netp');
    const outcome = await manager.release('/m.onnx');
    expect(outcome).toEqual({ status: 'failed', message: 'device lost' });
    expect(manager.size).toBe(1);
    const cached = await manager.getSession('/m.onnx', 'u2netp');
    expect(cached.releaseFailed).toBe(true);
  });
});

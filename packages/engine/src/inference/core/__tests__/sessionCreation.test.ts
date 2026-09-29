import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionWithTimeout,
  SessionCleanupFailedError,
  SessionCreationTimeoutError,
} from '../sessionCreation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('createSessionWithTimeout', () => {
  it('returns a session created before its deadline without releasing it', async () => {
    const release = vi.fn();
    const session = { release };

    await expect(
      createSessionWithTimeout(Promise.resolve(session), 100, 'ONNX WASM'),
    ).resolves.toBe(session);
    expect(release).not.toHaveBeenCalled();
  });

  it('waits for a late session and confirms release before allowing fallback', async () => {
    vi.useFakeTimers();
    const create = deferred<{ release: () => void }>();
    const release = vi.fn();
    const result = createSessionWithTimeout(
      create.promise.then((session) => ({ ...session, release })),
      10,
      'ONNX WebGPU',
    );
    const rejection = expect(result).rejects.toBeInstanceOf(SessionCreationTimeoutError);

    await vi.advanceTimersByTimeAsync(10);
    expect(release).not.toHaveBeenCalled();
    create.resolve({ release: vi.fn() });

    await rejection;
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('permits fallback after a timed-out create rejects without producing a session', async () => {
    vi.useFakeTimers();
    const create = deferred<{ release: () => void }>();
    const result = createSessionWithTimeout(create.promise, 10, 'ONNX WebGPU');
    const rejection = expect(result).rejects.toBeInstanceOf(SessionCreationTimeoutError);

    await vi.advanceTimersByTimeAsync(10);
    create.reject(new Error('provider initialization failed'));
    await rejection;
  });

  it('fails closed when a late session cannot confirm release', async () => {
    vi.useFakeTimers();
    const create = deferred<{ release: () => void }>();
    const result = createSessionWithTimeout(
      create.promise.then(() => ({ release: () => Promise.reject(new Error('device lost')) })),
      10,
      'ONNX WebGPU',
    );
    const rejection = expect(result).rejects.toBeInstanceOf(SessionCleanupFailedError);

    await vi.advanceTimersByTimeAsync(10);
    create.resolve({ release: vi.fn() });
    await rejection;
  });
});

import { describe, expect, it, vi } from 'vitest';
import { InferenceSessionRegistry, type RegistrySessionHandle } from './sessionRegistry';

function factory(
  create: () => Promise<{ session: RegistrySessionHandle; executionProvider: string }>,
  modelType = 'sam2-encoder',
  estimateBytes = 100,
) {
  return async () => ({ ...(await create()), modelType, estimateBytes });
}

describe('InferenceSessionRegistry', () => {
  it('coalesces concurrent creation into a single session', async () => {
    const registry = new InferenceSessionRegistry(3);
    const release = vi.fn(async () => {});
    let creates = 0;
    let resolveCreate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveCreate = resolve;
    });
    const sharedFactory = factory(async () => {
      creates += 1;
      await gate;
      return { session: { release }, executionProvider: 'wasm' };
    });

    const first = registry.getOrCreate('sam2-encoder:/a.onnx', sharedFactory);
    const second = registry.getOrCreate('sam2-encoder:/a.onnx', sharedFactory);
    resolveCreate!();
    const [a, b] = await Promise.all([first, second]);

    expect(creates).toBe(1);
    expect(a.entry).toBe(b.entry);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(registry.size).toBe(1);
    expect(release).not.toHaveBeenCalled();
  });

  it('does not cache a failed creation and allows a retry', async () => {
    const registry = new InferenceSessionRegistry(3);
    const failing = factory(async () => {
      throw new Error('boom');
    });
    await expect(registry.getOrCreate('k', failing)).rejects.toThrow('boom');
    expect(registry.size).toBe(0);

    const recovered = factory(async () => ({
      session: { release: vi.fn(async () => {}) },
      executionProvider: 'wasm',
    }));
    await expect(registry.getOrCreate('k', recovered)).resolves.toMatchObject({ created: true });
    expect(registry.size).toBe(1);
  });

  it('releases before removing the cache entry and reports failures as unresolved', async () => {
    const registry = new InferenceSessionRegistry(3);
    const order: string[] = [];
    const releaseOk = vi.fn(async () => {
      order.push('released');
    });
    const releaseFails = vi.fn(async () => {
      order.push('release-failed');
      throw new Error('device lost');
    });
    await registry.getOrCreate(
      'ok',
      factory(async () => ({ session: { release: releaseOk }, executionProvider: 'wasm' })),
    );
    await registry.getOrCreate(
      'bad',
      factory(
        async () => ({ session: { release: releaseFails }, executionProvider: 'wasm' }),
        'grounding-dino',
        2048,
      ),
    );

    const report = await registry.release(['ok', 'bad']);
    expect(order).toEqual(['released', 'release-failed']);
    expect(report.released).toEqual(['ok']);
    expect(report.failed).toEqual([{ key: 'bad', message: 'device lost' }]);
    expect(report.possiblyResidentBytes).toBe(2048);
    expect(report.remaining).toBe(1);
    expect(registry.get('bad')?.releaseFailed).toBe(true);

    const snapshot = registry.snapshot();
    expect(snapshot.unresolvedKeys).toEqual(['bad']);
    expect(snapshot.unresolvedBytes).toBe(2048);
    // The next stage must assume the failed session may still be resident.
    expect(snapshot.retainedCapacityBytes).toBe(2048);
  });

  it('refuses to release sessions with in-flight runs', async () => {
    const registry = new InferenceSessionRegistry(3);
    const release = vi.fn(async () => {});
    await registry.getOrCreate(
      'busy',
      factory(async () => ({ session: { release }, executionProvider: 'wasm' })),
    );

    registry.beginRun('busy');
    const first = await registry.release();
    expect(first.inUse).toEqual(['busy']);
    expect(release).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);

    registry.endRun('busy');
    const second = await registry.release();
    expect(second.released).toEqual(['busy']);
    expect(release).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('evicts only idle sessions when over capacity', async () => {
    const registry = new InferenceSessionRegistry(2);
    const release = vi.fn(async () => {});
    for (const key of ['a', 'b', 'c']) {
      await registry.getOrCreate(
        key,
        factory(async () => ({ session: { release }, executionProvider: 'wasm' })),
      );
    }
    expect(registry.size).toBe(3);
    registry.beginRun('a');
    const eviction = await registry.evictIdleToCapacity();
    expect(eviction.inUse).toEqual([]);
    expect(eviction.released).toHaveLength(1);
    expect(eviction.released[0]).not.toBe('a');
    expect(registry.size).toBe(2);
    expect(registry.get('a')).toBeDefined();
    registry.endRun('a');
  });

  it('reports retained capacity without pretending failed releases freed bytes', async () => {
    const registry = new InferenceSessionRegistry(3);
    const release = vi.fn(async () => {});
    await registry.getOrCreate(
      'small',
      factory(async () => ({ session: { release }, executionProvider: 'wasm' }), 'depth', 671),
    );
    expect(registry.snapshot()).toMatchObject({
      cached: 1,
      unresolvedBytes: 0,
      retainedCapacityBytes: 671,
      highWaterBytes: 671,
    });
    await registry.release();
    expect(registry.snapshot()).toMatchObject({
      cached: 0,
      unresolvedBytes: 0,
      retainedCapacityBytes: 0,
      // High water is diagnostic only: release cannot prove the wasm heap shrank.
      highWaterBytes: 671,
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createFinalizerRegistry } from '../finalizers';

function controlledFinalizer(
  id: string,
  scope: 'document' | 'window' | 'application' = 'application',
  priority = 0,
) {
  return { id, scope, priority, finalize: vi.fn(async () => undefined) };
}

describe('finalizer registry', () => {
  it('runs finalizers for the scope in priority order', async () => {
    const registry = createFinalizerRegistry({ deadlineMs: 1_000 });
    const low = controlledFinalizer('low', 'window', 10);
    const high = controlledFinalizer('high', 'window', 1);
    const app = controlledFinalizer('app', 'application', 5);
    registry.register(low);
    registry.register(high);
    registry.register(app);
    await registry.runFor('window');
    const orderOf = (mock: ReturnType<typeof vi.fn>) => mock.mock.invocationCallOrder[0] ?? 0;
    expect(orderOf(high.finalize)).toBeLessThan(orderOf(app.finalize));
    expect(orderOf(app.finalize)).toBeLessThan(orderOf(low.finalize));
  });

  it('does not run finalizers owned by narrower scopes', async () => {
    const registry = createFinalizerRegistry({ deadlineMs: 1_000 });
    const documentScoped = controlledFinalizer('doc', 'document');
    const applicationScoped = controlledFinalizer('app', 'application');
    registry.register(documentScoped);
    registry.register(applicationScoped);
    await registry.runFor('application');
    expect(documentScoped.finalize).not.toHaveBeenCalled();
    expect(applicationScoped.finalize).toHaveBeenCalledOnce();
  });

  it('unregister removes a finalizer', async () => {
    const registry = createFinalizerRegistry({ deadlineMs: 1_000 });
    const f = controlledFinalizer('f');
    const remove = registry.register(f);
    remove();
    await registry.runFor('application');
    expect(f.finalize).not.toHaveBeenCalled();
  });

  it('never waits forever: the deadline aborts pending finalizers', async () => {
    const registry = createFinalizerRegistry({ deadlineMs: 50 });
    let sawAbort = false;
    registry.register({
      id: 'hang',
      scope: 'application',
      priority: 0,
      finalize: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            sawAbort = true;
            resolve();
          });
        }),
    });
    await registry.runFor('application');
    expect(sawAbort).toBe(true);
  });

  it('a throwing finalizer does not block commit', async () => {
    const registry = createFinalizerRegistry({ deadlineMs: 1_000 });
    const bad = {
      id: 'bad',
      scope: 'application' as const,
      priority: 0,
      finalize: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const good = controlledFinalizer('good');
    registry.register(bad);
    registry.register(good);
    await expect(registry.runFor('application')).resolves.toBeUndefined();
    expect(good.finalize).toHaveBeenCalledOnce();
  });
});

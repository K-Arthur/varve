import { describe, expect, it } from 'vitest';
import { SemanticEmbeddingQueue } from './semanticEmbeddingQueue';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SemanticEmbeddingQueue', () => {
  it('honors priority and bounded concurrency', async () => {
    const queue = new SemanticEmbeddingQueue<string>(1);
    const order: string[] = [];
    const first = queue.enqueue({
      id: 'first',
      run: async () => {
        order.push('first');
        await tick();
        return 'first';
      },
    });
    const low = queue.enqueue({
      id: 'low',
      priority: 1,
      run: async () => {
        order.push('low');
        return 'low';
      },
    });
    const high = queue.enqueue({
      id: 'high',
      priority: 10,
      run: async () => {
        order.push('high');
        return 'high';
      },
    });
    await Promise.all([first, low, high]);
    expect(order).toEqual(['first', 'high', 'low']);
    expect(queue.getStats().completed).toBe(3);
  });

  it('pauses pending work and suppresses stale results', async () => {
    const queue = new SemanticEmbeddingQueue<number>(1);
    queue.pause();
    const paused = queue.enqueue({ id: 'paused', run: async () => 1 });
    expect(queue.getStats().pending).toBe(1);
    queue.resume();
    expect(await paused).toBe(1);

    let current = true;
    const stale = queue.enqueue({
      id: 'stale',
      isCurrent: () => current,
      run: async () => {
        current = false;
        return 2;
      },
    });
    expect(await stale).toBeUndefined();
    expect(queue.getStats().cancelled).toBe(1);
  });

  it('cancels pending jobs', async () => {
    const queue = new SemanticEmbeddingQueue<number>(1);
    let release!: () => void;
    const running = queue.enqueue({
      id: 'running',
      run: () =>
        new Promise<number>((resolve) => {
          release = () => resolve(1);
        }),
    });
    const pending = queue.enqueue({ id: 'pending', run: async () => 2 });
    expect(queue.cancel('pending')).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await expect(running).resolves.toBe(1);
  });
});

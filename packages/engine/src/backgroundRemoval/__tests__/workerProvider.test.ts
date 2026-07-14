import { beforeEach, describe, expect, it } from 'vitest';

// Import the provider directly — the isAvailable method now does an async
// model-availability check. We verify the behavioral contract rather than
// mocking internals, since vi.mock doesn't intercept dynamic imports reliably.
const { workerRemovalProvider } = await import('../providers/workerProvider');

describe('workerRemovalProvider', () => {
  describe('isAvailable', () => {
    it('returns false when Worker is not defined', async () => {
      const original = globalThis.Worker;
      // @ts-expect-error testing unavailable Worker
      delete globalThis.Worker;
      try {
        const result = await workerRemovalProvider.isAvailable({ method: 'ai-balanced' });
        expect(result).toBe(false);
      } finally {
        globalThis.Worker = original;
      }
    });

    it('returns false for quick method (no model needed)', async () => {
      const result = await workerRemovalProvider.isAvailable({ method: 'quick' });
      expect(result).toBe(false);
    });

    it('isAvailable is async (returns a Promise, not a boolean)', () => {
      // The old implementation was synchronous: `typeof Worker !== 'undefined'`.
      // The new one is async because it checks model availability via the loader.
      const result = workerRemovalProvider.isAvailable({ method: 'ai-balanced' });
      expect(result).toBeInstanceOf(Promise);
    });

    it('provider id is worker-onnx', () => {
      expect(workerRemovalProvider.id).toBe('worker-onnx');
    });
  });
});

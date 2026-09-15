import { describe, expect, it } from 'vitest';
import { yieldToMain } from './scheduling';

describe('yieldToMain', () => {
  it('resolves through the available scheduling fallback', async () => {
    await expect(yieldToMain()).resolves.toBeUndefined();
  });

  it('honors cancellation before and after yielding', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(yieldToMain(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

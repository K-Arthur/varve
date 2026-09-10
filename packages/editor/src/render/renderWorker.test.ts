import { describe, expect, it } from 'vitest';
import { createRenderWorkerHost, isStaleResponse } from './workerHost';

describe('render worker host', () => {
  it('isStaleResponse detects outdated doc versions', () => {
    expect(isStaleResponse(5, 4)).toBe(true);
    expect(isStaleResponse(5, 5)).toBe(false);
    expect(isStaleResponse(5, 6)).toBe(false);
  });

  it('createRenderWorkerHost returns null without Worker', () => {
    const original = globalThis.Worker;
    // @ts-expect-error test override
    globalThis.Worker = undefined;
    expect(createRenderWorkerHost(() => {})).toBeNull();
    globalThis.Worker = original;
  });
});

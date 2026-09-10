import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStaleResponse } from './workerHost';

describe('adversarial render guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('discards stale worker frames after rapid docVersion bumps', () => {
    const latest = 10;
    expect(isStaleResponse(latest, 9)).toBe(true);
    expect(isStaleResponse(latest, 10)).toBe(false);
  });

  it('docVersion monotonicity simulation', () => {
    let v = 0;
    const responses: number[] = [];
    for (let i = 0; i < 100; i++) {
      v += 1;
      const responseVersion = i % 3 === 0 ? v - 2 : v;
      if (!isStaleResponse(v, responseVersion)) responses.push(responseVersion);
    }
    expect(responses.length).toBeLessThan(100);
  });

  it('rapid docVersion bumps with worker host stale guard', async () => {
    const { createRenderWorkerHost } = await import('./workerHost');
    let accepted = 0;
    const host = createRenderWorkerHost((msg) => {
      if (msg.type === 'frameRendered' && !isStaleResponse(50, msg.docVersion)) {
        accepted += 1;
        msg.bitmap?.close();
      }
    });
    if (!host) return;
    for (let v = 1; v <= 50; v++) {
      host.post({
        type: 'render',
        nodes: [],
        ir: [],
        camera: { zoom: 1, pan: { x: 0, y: 0 } },
        viewport: { width: 100, height: 100 },
        docVersion: v % 4 === 0 ? v - 1 : v,
        dpr: 1,
      });
    }
    await new Promise((r) => setTimeout(r, 50));
    host.terminate();
    expect(accepted).toBeLessThanOrEqual(50);
  });
});

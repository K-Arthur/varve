import { describe, expect, it } from 'vitest';
import { isStaleResponse } from '../render/workerHost';

describe('adversarial render guards', () => {
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
});

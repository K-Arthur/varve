import { describe, expect, it } from 'vitest';
import { checkStartupCapabilities } from './capabilityCheck';

describe('checkStartupCapabilities', () => {
  it('returns canAnimate based on prefers-reduced-motion', () => {
    const caps = checkStartupCapabilities();
    expect(typeof caps.canAnimate).toBe('boolean');
  });

  it('returns gpuScore between 0 and 1', () => {
    const caps = checkStartupCapabilities();
    expect(caps.gpuScore).toBeGreaterThanOrEqual(0);
    expect(caps.gpuScore).toBeLessThanOrEqual(1);
  });

  it('detects canvas availability', () => {
    const caps = checkStartupCapabilities();
    expect(caps.canvasAvailable).toBe(true);
  });

  it('sets shouldSimplify when reduced-motion is active', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion: reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });

    const caps = checkStartupCapabilities();
    expect(caps.shouldSimplify).toBe(true);
  });
});

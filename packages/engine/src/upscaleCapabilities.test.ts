import { describe, expect, it } from 'vitest';

import { detectUpscaleCapabilities } from './upscaleCapabilities';

describe('detectUpscaleCapabilities', () => {
  it('reports available in browser environment', async () => {
    const caps = await detectUpscaleCapabilities();
    expect(caps.available).toBe(true);
  });

  it('detects worker availability', async () => {
    const caps = await detectUpscaleCapabilities();
    expect(caps.workerAvailable).toBe(typeof Worker !== 'undefined');
  });

  it('reports a path description', async () => {
    const caps = await detectUpscaleCapabilities();
    expect(caps.pathDescription).toBeTruthy();
    expect(typeof caps.pathDescription).toBe('string');
  });

  it('reports max output pixels', async () => {
    const caps = await detectUpscaleCapabilities();
    expect(caps.maxOutputPixels).toBeGreaterThan(0);
  });
});

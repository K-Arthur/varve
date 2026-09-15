import { describe, expect, it } from 'vitest';

import { DEFAULT_UPSCALE_MODE, getUpscaleMode, UPSCALE_MODES } from './upscaleModes';

describe('UPSCALE_MODES', () => {
  it('defines six user-facing modes', () => {
    expect(UPSCALE_MODES).toHaveLength(6);
  });

  it('maps each mode to a valid engine method', () => {
    for (const mode of UPSCALE_MODES) {
      expect(['nearest', 'bilinear', 'bicubic', 'lanczos3', 'ai']).toContain(mode.method);
    }
  });

  it('locks scale for AI mode', () => {
    const ai = getUpscaleMode('ai-enhance');
    expect(ai?.lockedScale).toBe(true);
    expect(ai?.defaultScale).toBe(4);
    expect(ai?.isAi).toBe(true);
  });

  it('allows fractional scales for non-pixel-art modes', () => {
    const fast = getUpscaleMode('fast');
    expect(fast?.integerOnly).toBe(false);
    expect(fast?.scaleOptions).toContain(1.5);
  });

  it('restricts pixel-art to integer scales', () => {
    const pixel = getUpscaleMode('pixel-art');
    expect(pixel?.integerOnly).toBe(true);
    expect(pixel?.method).toBe('nearest');
  });

  it('has a valid default mode', () => {
    expect(getUpscaleMode(DEFAULT_UPSCALE_MODE)).toBeDefined();
  });

  it('returns undefined for unknown mode', () => {
    expect(getUpscaleMode('nonexistent' as never)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { getUpscaleModeOptions } from './upscaleModeOptions';

describe('upscale mode admission', () => {
  it('keeps the anime model unavailable until provenance and quality gates pass', () => {
    const options = getUpscaleModeOptions();
    const anime = options.find((option) => option.value === 'illustration');
    const general = options.find((option) => option.value === 'ai-enhance');

    expect(anime).toMatchObject({
      disabled: true,
      disabledReason: expect.stringMatching(/synthetic browser-WASM smoke/i),
    });
    expect(general).not.toHaveProperty('disabled', true);
  });
});

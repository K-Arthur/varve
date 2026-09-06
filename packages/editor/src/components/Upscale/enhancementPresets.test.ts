import { describe, expect, it } from 'vitest';
import { ENHANCEMENT_PRESETS, getEnhancementPreset } from './enhancementPresets';

describe('enhancement presets', () => {
  it('covers the supported operation paths without changing output behavior', () => {
    expect(new Set(ENHANCEMENT_PRESETS.map((preset) => preset.id)).size).toBe(
      ENHANCEMENT_PRESETS.length,
    );
    expect(ENHANCEMENT_PRESETS.map((preset) => preset.operation)).toEqual(
      expect.arrayContaining([
        'auto',
        'upscale',
        'denoise',
        'restore-upscale',
        'deblur',
        'deblur-upscale',
      ]),
    );
    for (const preset of ENHANCEMENT_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.scale).toBeGreaterThan(0);
      expect(preset.deblurStrength).toBeGreaterThanOrEqual(0);
      expect(preset.deblurStrength).toBeLessThanOrEqual(1);
    }
  });

  it('returns stable processing settings for a named preset', () => {
    expect(getEnhancementPreset('photo-cleanup')).toMatchObject({
      operation: 'restore-upscale',
      mode: 'quality',
      scale: 2,
      denoiseStrength: 'medium',
    });
    expect(getEnhancementPreset('custom')).toBeUndefined();
  });
});

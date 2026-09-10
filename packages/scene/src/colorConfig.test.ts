import { describe, expect, it } from 'vitest';
import {
  colorConfigWithDefaults,
  DEFAULT_BIT_DEPTH,
  DEFAULT_WORKING_SPACE,
  defaultCmykColorConfig,
  defaultColorConfig,
  defaultRgbColorConfig,
  type WorkingSpace,
} from './colorManagement';

describe('ColorConfig with bitDepth and workingSpace', () => {
  it('defaultRgbColorConfig includes bitDepth and workingSpace', () => {
    const config = defaultRgbColorConfig();
    expect(config.bitDepth).toBe('uint8');
    expect(config.workingSpace).toBe('srgb');
    expect(config.mode).toBe('rgb');
  });

  it('defaultCmykColorConfig includes bitDepth and workingSpace', () => {
    const config = defaultCmykColorConfig();
    expect(config.bitDepth).toBe('uint8');
    expect(config.workingSpace).toBe('srgb');
    expect(config.mode).toBe('cmyk');
  });

  it('defaultColorConfig accepts bitDepth parameter', () => {
    const config = defaultColorConfig('rgb', 'float32');
    expect(config.bitDepth).toBe('float32');
  });

  it('defaultColorConfig defaults to uint8', () => {
    const config = defaultColorConfig('cmyk');
    expect(config.bitDepth).toBe('uint8');
  });

  it('DEFAULT_WORKING_SPACE is srgb', () => {
    expect(DEFAULT_WORKING_SPACE).toBe('srgb');
  });

  it('DEFAULT_BIT_DEPTH is uint8', () => {
    expect(DEFAULT_BIT_DEPTH).toBe('uint8');
  });
});

describe('colorConfigWithDefaults', () => {
  it('returns full defaults when config is undefined', () => {
    const config = colorConfigWithDefaults(undefined);
    expect(config.bitDepth).toBe('uint8');
    expect(config.workingSpace).toBe('srgb');
    expect(config.mode).toBe('rgb');
  });

  it('fills in missing bitDepth and workingSpace', () => {
    // Simulate a v2.3 document that has colorConfig but no bitDepth/workingSpace
    const legacy = {
      mode: 'cmyk' as const,
      rgbProfile: { id: 'srgb', name: 'sRGB' },
      cmykProfile: { id: 'fogra39', name: 'Fogra39' },
      blackGeneration: { mode: 'standard' as const, overprintBlack: false },
    };
    const config = colorConfigWithDefaults(legacy as never);
    expect(config.bitDepth).toBe('uint8');
    expect(config.workingSpace).toBe('srgb');
    expect(config.mode).toBe('cmyk');
  });

  it('preserves existing bitDepth and workingSpace', () => {
    const config = colorConfigWithDefaults({
      mode: 'rgb',
      bitDepth: 'float32',
      workingSpace: 'linear',
      rgbProfile: { id: 'srgb', name: 'sRGB' },
      cmykProfile: { id: 'fogra39', name: 'Fogra39' },
      blackGeneration: { mode: 'standard', overprintBlack: false },
    });
    expect(config.bitDepth).toBe('float32');
    expect(config.workingSpace).toBe('linear');
  });
});

describe('WorkingSpace type', () => {
  it('accepts srgb and linear', () => {
    const spaces: WorkingSpace[] = ['srgb', 'linear'];
    expect(spaces).toHaveLength(2);
  });
});

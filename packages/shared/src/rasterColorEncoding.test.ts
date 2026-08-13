import { describe, expect, it } from 'vitest';
import { type RasterColorEncoding, rasterEncodingKey } from './rasterColorEncoding';

describe('rasterEncodingKey', () => {
  const base: RasterColorEncoding = {
    model: 'rgb',
    primaries: 'srgb',
    transfer: 'srgb',
    bitDepth: 8,
    alphaMode: 'straight',
    provenance: 'named',
    diagnostics: ['different explanation does not change meaning'],
  };

  it('is deterministic and excludes diagnostics', () => {
    expect(rasterEncodingKey(base)).toBe(rasterEncodingKey({ ...base, diagnostics: ['other'] }));
  });

  it('changes when channel interpretation changes', () => {
    expect(rasterEncodingKey(base)).not.toBe(
      rasterEncodingKey({ ...base, primaries: 'display-p3' }),
    );
    expect(rasterEncodingKey(base)).not.toBe(rasterEncodingKey({ ...base, bitDepth: 'float32' }));
    expect(rasterEncodingKey(base)).not.toBe(rasterEncodingKey({ ...base, profileId: 'icc-p3' }));
  });
});

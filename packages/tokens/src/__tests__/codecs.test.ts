/**
 * Token-type codec tests against the 2025.10 format report grammar.
 */
import { describe, expect, it } from 'vitest';

import { validateTokenValue } from '../codecs';

function check(type: string, value: unknown) {
  return validateTokenValue(type, value, { sourceFileId: 't', pointer: '/x', path: ['x'] });
}

function codes(type: string, value: unknown): string[] {
  return check(type, value).diagnostics.map((d) => d.code);
}

describe('color codec', () => {
  it('accepts srgb with valid components', () => {
    expect(codes('color', { colorSpace: 'srgb', components: [1, 0, 0] })).toEqual([]);
  });

  it('accepts the none keyword and alpha and hex', () => {
    expect(
      codes('color', {
        colorSpace: 'hsl',
        components: ['none', 0, 100],
        alpha: 0.5,
        hex: '#ffffff',
      }),
    ).toEqual([]);
  });

  it('rejects out-of-range components', () => {
    expect(codes('color', { colorSpace: 'srgb', components: [1.5, 0, 0] })).toContain(
      'codec.color.component-range',
    );
    expect(codes('color', { colorSpace: 'hsl', components: [360, 0, 0] })).toContain(
      'codec.color.component-range',
    );
  });

  it('rejects wrong component counts', () => {
    expect(codes('color', { colorSpace: 'srgb', components: [1, 0] })).toContain(
      'codec.color.component-count',
    );
  });

  it('rejects unknown color spaces', () => {
    expect(codes('color', { colorSpace: 'cmyk', components: [0, 0, 0, 0] })).toContain(
      'codec.color.unknown-space',
    );
  });

  it('rejects bad alpha and hex', () => {
    expect(codes('color', { colorSpace: 'srgb', components: [0, 0, 0], alpha: 1.5 })).toContain(
      'codec.color.alpha',
    );
    expect(codes('color', { colorSpace: 'srgb', components: [0, 0, 0], hex: 'ff00ff' })).toContain(
      'codec.color.hex',
    );
  });
});

describe('dimension codec', () => {
  it('accepts px and rem only', () => {
    expect(codes('dimension', { value: 0, unit: 'px' })).toEqual([]);
    expect(codes('dimension', { value: 1.5, unit: 'rem' })).toEqual([]);
    expect(codes('dimension', { value: 10, unit: 'pt' })).toContain('codec.dimension.unit');
    expect(codes('dimension', { value: 10, unit: 'em' })).toContain('codec.dimension.unit');
  });

  it('requires unit even when value is 0', () => {
    expect(codes('dimension', { value: 0 })).toContain('codec.dimension.unit');
  });
});

describe('duration codec', () => {
  it('accepts ms and s', () => {
    expect(codes('duration', { value: 100, unit: 'ms' })).toEqual([]);
    expect(codes('duration', { value: 1.5, unit: 's' })).toEqual([]);
    expect(codes('duration', { value: 1, unit: 'h' })).toContain('codec.duration.unit');
  });
});

describe('cubic bezier codec', () => {
  it('accepts four numbers with x in [0,1]', () => {
    expect(codes('cubicBezier', [0.5, 0, 1, 1])).toEqual([]);
    expect(codes('cubicBezier', [0, 0, 0.5, 1])).toEqual([]);
  });

  it('rejects x coordinates outside [0,1]', () => {
    expect(codes('cubicBezier', [1.5, 0, 1, 1])).toContain('codec.cubic-bezier.x-range');
  });

  it('rejects wrong lengths', () => {
    expect(codes('cubicBezier', [0, 0, 1])).toContain('codec.cubic-bezier.length');
  });
});

describe('font weight codec', () => {
  it('accepts numbers in [1,1000] and alias strings', () => {
    expect(codes('fontWeight', 350)).toEqual([]);
    expect(codes('fontWeight', 1000)).toEqual([]);
    expect(codes('fontWeight', 'bold')).toEqual([]);
    expect(codes('fontWeight', 'semi-bold')).toEqual([]);
  });

  it('rejects out-of-range and unknown strings', () => {
    expect(codes('fontWeight', 0)).toContain('codec.font-weight.value');
    expect(codes('fontWeight', 1001)).toContain('codec.font-weight.value');
    expect(codes('fontWeight', 'Bold')).toContain('codec.font-weight.value');
  });
});

describe('font family codec', () => {
  it('accepts strings and arrays', () => {
    expect(codes('fontFamily', 'Comic Sans MS')).toEqual([]);
    expect(codes('fontFamily', ['Helvetica', 'Arial', 'sans-serif'])).toEqual([]);
  });

  it('rejects empty values', () => {
    expect(codes('fontFamily', '')).toContain('codec.font-family.value');
    expect(codes('fontFamily', [])).toContain('codec.font-family.value');
  });
});

describe('stroke style codec', () => {
  it('accepts predefined strings and object form', () => {
    expect(codes('strokeStyle', 'dashed')).toEqual([]);
    expect(
      codes('strokeStyle', { dashArray: [{ value: 4, unit: 'px' }], lineCap: 'round' }),
    ).toEqual([]);
  });

  it('rejects unknown strings and properties', () => {
    expect(codes('strokeStyle', 'wavy')).toContain('codec.stroke-style.value');
    expect(
      codes('strokeStyle', { dashArray: [{ value: 4, unit: 'px' }], lineCap: 'bogus' }),
    ).toContain('codec.stroke-style.line-cap');
    expect(codes('strokeStyle', { dashArray: [], lineCap: 'round' })).toContain(
      'codec.stroke-style.dash-array',
    );
  });
});

describe('border/transition codecs', () => {
  it('requires all border fields', () => {
    expect(codes('border', { color: '#000', width: { value: 1, unit: 'px' } })).toContain(
      'codec.border.style',
    );
  });

  it('requires all transition fields', () => {
    expect(
      codes('transition', {
        duration: { value: 200, unit: 'ms' },
        delay: { value: 0, unit: 'ms' },
      }),
    ).toContain('codec.transition.timing-function');
  });
});

describe('shadow codec', () => {
  it('requires shadow fields', () => {
    expect(
      codes('shadow', {
        color: '#000',
        offsetX: { value: 0, unit: 'px' },
        offsetY: { value: 0, unit: 'px' },
        blur: { value: 4, unit: 'px' },
      }),
    ).toContain('codec.shadow.required');
  });

  it('accepts valid shadows and arrays', () => {
    const shadow = {
      color: '#000',
      offsetX: { value: 0, unit: 'px' },
      offsetY: { value: 2, unit: 'px' },
      blur: { value: 4, unit: 'px' },
      spread: { value: 0, unit: 'px' },
      inset: true,
    };
    expect(codes('shadow', shadow)).toEqual([]);
    expect(codes('shadow', [shadow, '{other.shadow}'])).toEqual([]);
  });
});

describe('gradient codec', () => {
  it('accepts gradient stops', () => {
    expect(
      codes('gradient', [
        { color: '#000', position: 0 },
        { color: '#fff', position: 1 },
      ]),
    ).toEqual([]);
  });

  it('rejects empty gradients and missing fields', () => {
    expect(codes('gradient', [])).toContain('codec.gradient.value');
    expect(codes('gradient', [{ color: '#000' }])).toContain('codec.gradient.stop');
  });
});

describe('typography codec', () => {
  it('requires all five fields', () => {
    const base = {
      fontFamily: 'Inter',
      fontSize: { value: 16, unit: 'px' },
      fontWeight: 400,
      letterSpacing: { value: 0, unit: 'px' },
      lineHeight: 1.5,
    };
    expect(codes('typography', base)).toEqual([]);
    expect(codes('typography', { ...base, lineHeight: undefined })).toContain(
      'codec.typography.required',
    );
  });
});

describe('references pass through codecs', () => {
  it('accepts property-level $ref values for any type', () => {
    expect(codes('dimension', { $ref: '#/spacing/$value' })).toEqual([]);
    expect(codes('number', { $ref: '#/base/$value/components/0' })).toEqual([]);
  });

  it('preserves unknown types unvalidated', () => {
    expect(codes('futureType', 'anything')).toEqual([]);
  });
});

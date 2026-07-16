import { describe, expect, it } from 'vitest';
import { applyLutToImageData } from './apply';
import { sampleLut3D } from './interpolate';
import { parse3dlData } from './parse3dl';
import { CubeParseError, parseCubeData } from './parseCube';
import { makeIdentityLut3D } from './types';

describe('edge cases — malformed .cube files', () => {
  it('empty file throws', () => {
    expect(() => parseCubeData('')).toThrow(CubeParseError);
  });

  it('whitespace-only file throws', () => {
    expect(() => parseCubeData('   \n  \n  ')).toThrow(CubeParseError);
  });

  it('file with only comments throws', () => {
    expect(() => parseCubeData('# comment\n# another\n')).toThrow(CubeParseError);
  });

  it('NaN values are rejected', () => {
    const content = 'LUT_3D_SIZE 2\nNaN 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
    expect(() => parseCubeData(content)).toThrow(CubeParseError);
  });

  it('Infinity values are rejected', () => {
    const content = 'LUT_3D_SIZE 2\nInf 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
    expect(() => parseCubeData(content)).toThrow(CubeParseError);
  });

  it('very large grid size exceeding limit is rejected', () => {
    expect(() => parseCubeData('LUT_3D_SIZE 512\n')).toThrow(CubeParseError);
  });

  it('custom domain values are preserved', () => {
    const content = `DOMAIN_MIN -0.5 -0.5 -0.5
DOMAIN_MAX 1.5 1.5 1.5
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
    const result = parseCubeData(content);
    if (result.transform.kind === '3d') {
      expect(result.transform.inputMin[0]).toBe(-0.5);
      expect(result.transform.inputMax[0]).toBe(1.5);
    }
  });
});

describe('edge cases — .3dl files', () => {
  it('file with extra whitespace lines', () => {
    const lines = [
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '',
      '   ',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ];
    const result = parse3dlData(lines.join('\n'));
    expect(result.transform.size).toBe(2);
  });
});

describe('edge cases — interpolation', () => {
  it('values outside [0,1] are clamped for identity LUT', () => {
    const lut = makeIdentityLut3D(17);
    const result = sampleLut3D(lut, -0.5, 1.5, 2.0, 'tetrahedral');
    expect(result[0]).toBeCloseTo(0, 3);
    expect(result[1]).toBeCloseTo(1, 3);
    expect(result[2]).toBeCloseTo(1, 3);
  });

  it('values at exact grid points', () => {
    const lut = makeIdentityLut3D(17);
    const result = sampleLut3D(lut, 0.5, 0.5, 0.5, 'tetrahedral');
    expect(result[0]).toBeCloseTo(0.5, 4);
    expect(result[1]).toBeCloseTo(0.5, 4);
    expect(result[2]).toBeCloseTo(0.5, 4);
  });

  it('non-uniform input domain maps correctly', () => {
    const lut = makeIdentityLut3D(17);
    lut.inputMin = [0, 0, 0];
    lut.inputMax = [2, 2, 2];
    const result = sampleLut3D(lut, 1.0, 1.0, 1.0, 'tetrahedral');
    expect(result[0]).toBeCloseTo(0.5, 3);
    expect(result[1]).toBeCloseTo(0.5, 3);
    expect(result[2]).toBeCloseTo(0.5, 3);
  });
});

describe('edge cases — image application', () => {
  it('very small LUT (size 2) does not crash', () => {
    const lut = makeIdentityLut3D(2);
    const imageData = new ImageData(4, 4);
    const data = imageData.data;
    for (let i = 0; i < data.length; i++) data[i] = 128;
    expect(() => {
      applyLutToImageData(imageData, lut, 1, 'tetrahedral');
    }).not.toThrow();
  });

  it('transparent pixels remain transparent', () => {
    const lut = makeIdentityLut3D(17);
    const imageData = new ImageData(2, 2);
    const data = imageData.data;
    data[0] = 255;
    data[1] = 0;
    data[2] = 0;
    data[3] = 0;
    data[4] = 0;
    data[5] = 255;
    data[6] = 0;
    data[7] = 0;

    applyLutToImageData(imageData, lut, 1, 'tetrahedral');

    expect(data[3]).toBe(0);
    expect(data[7]).toBe(0);
  });
});

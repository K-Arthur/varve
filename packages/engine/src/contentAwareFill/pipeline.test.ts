import { describe, expect, it } from 'vitest';
import { getLaMaOutputDimensions } from './pipeline';

describe('getLaMaOutputDimensions', () => {
  it('keeps NCHW height and width in their declared order for portrait sources', () => {
    expect(getLaMaOutputDimensions([1, 3, 7, 5])).toEqual({ width: 5, height: 7 });
  });

  it('supports CHW and HW output shapes through the same trailing-pair contract', () => {
    expect(getLaMaOutputDimensions([3, 7, 5])).toEqual({ width: 5, height: 7 });
    expect(getLaMaOutputDimensions([7, 5])).toEqual({ width: 5, height: 7 });
  });

  it('rejects non-positive output dimensions', () => {
    expect(() => getLaMaOutputDimensions([1, 3, 0, 5])).toThrow(
      'Fill inference returned invalid output dimensions',
    );
  });
});

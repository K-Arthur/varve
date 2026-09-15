import { describe, expect, it } from 'vitest';
import { combineAlphaMasks, invertAlphaMask } from './maskAlgebra';

const mask = (data: number[]) => ({ data: Uint8Array.from(data), width: 2, height: 2 });

describe('segmentation mask algebra', () => {
  it('supports replace, add, subtract, and intersect without mutation', () => {
    const base = mask([0, 64, 128, 255]);
    const incoming = mask([255, 128, 64, 0]);

    expect([...combineAlphaMasks(base, incoming, 'replace').data]).toEqual([255, 128, 64, 0]);
    expect([...combineAlphaMasks(base, incoming, 'add').data]).toEqual([255, 128, 128, 255]);
    expect([...combineAlphaMasks(base, incoming, 'subtract').data]).toEqual([0, 32, 96, 255]);
    expect([...combineAlphaMasks(base, incoming, 'intersect').data]).toEqual([0, 64, 64, 0]);
    expect([...base.data]).toEqual([0, 64, 128, 255]);
  });

  it('rejects incompatible dimensions', () => {
    expect(() => combineAlphaMasks(mask([1, 2, 3, 4]), { ...mask([1]), width: 1 }, 'add')).toThrow(
      'Mask dimensions must match',
    );
  });

  it('inverts into a new mask', () => {
    const original = mask([0, 1, 254, 255]);
    expect([...invertAlphaMask(original).data]).toEqual([255, 254, 1, 0]);
    expect([...original.data]).toEqual([0, 1, 254, 255]);
  });
});

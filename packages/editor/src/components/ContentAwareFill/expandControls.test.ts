import { describe, expect, it } from 'vitest';
import { expandPaddingForAspectRatio, expandPaddingForOutputSize } from './expandControls';

describe('Expand frame controls', () => {
  it('centers an odd-sized output delta without changing the source size', () => {
    expect(expandPaddingForOutputSize(100, 80, 111, 95)).toEqual({
      top: 7,
      right: 6,
      bottom: 8,
      left: 5,
    });
  });

  it('supports corner anchoring for bounded output frames', () => {
    expect(expandPaddingForOutputSize(100, 80, 140, 120, 'bottom-right')).toEqual({
      top: 40,
      right: 0,
      bottom: 0,
      left: 40,
    });
    expect(expandPaddingForOutputSize(100, 80, 140, 120, 'top-left')).toEqual({
      top: 0,
      right: 40,
      bottom: 40,
      left: 0,
    });
  });

  it('chooses a containing frame for an aspect ratio instead of cropping', () => {
    expect(expandPaddingForAspectRatio(1600, 1200, 16 / 9)).toEqual({
      top: 0,
      right: 267,
      bottom: 0,
      left: 267,
    });
    expect(expandPaddingForAspectRatio(1600, 1200, 1, 'top-right')).toEqual({
      top: 0,
      right: 0,
      bottom: 400,
      left: 0,
    });
  });

  it('rejects output frames that would crop the retained source', () => {
    expect(() => expandPaddingForOutputSize(100, 80, 99, 80)).toThrow(/not be smaller/i);
  });
});

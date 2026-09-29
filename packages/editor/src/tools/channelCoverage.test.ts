import { describe, expect, it } from 'vitest';
import { channelCoverage } from './channelCoverage';

describe('channel snapshots', () => {
  const source = {
    data: new Uint8ClampedArray([128, 24, 80, 128, 255, 255, 255, 0, 30, 80, 90, 255]),
    width: 3,
    height: 1,
  };
  it('keeps partial coverage and excludes hidden color', () => {
    expect(Array.from(channelCoverage(source, 'red'))).toEqual([64, 0, 30]);
    expect(Array.from(channelCoverage(source, 'red', true))).toEqual([64, 0, 225]);
    expect(Array.from(channelCoverage(source, 'alpha'))).toEqual([128, 0, 255]);
    expect(Array.from(channelCoverage(source, 'alpha', true))).toEqual([127, 255, 0]);
  });
});

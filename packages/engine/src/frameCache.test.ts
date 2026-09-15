import { describe, expect, it } from 'vitest';
import { FrameCache } from './frameCache';

describe('FrameCache', () => {
  it('keeps an entry alive while it is read every frame', () => {
    const cache = new FrameCache<string, object>();
    const value = {};
    cache.set('hot', value);

    for (let frame = 0; frame < 12; frame++) {
      cache.nextFrame();
      expect(cache.get('hot')).toBe(value);
      cache.sweep();
    }

    expect(cache.size()).toBe(1);
  });

  it('evicts an entry after four frames without a read', () => {
    const cache = new FrameCache<string, string>();
    cache.set('cold', 'value');

    for (let frame = 0; frame < 4; frame++) {
      cache.nextFrame();
      cache.sweep();
    }

    expect(cache.get('cold')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});

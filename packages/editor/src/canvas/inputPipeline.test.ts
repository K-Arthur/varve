import { describe, expect, it } from 'vitest';
import { shouldResolveHover } from './inputPipeline';

describe('canvas input hover policy', () => {
  it('resolves hover only for idle select and inspect pointers', () => {
    expect(shouldResolveHover('select', 0)).toBe(true);
    expect(shouldResolveHover('inspect', 0)).toBe(true);
    expect(shouldResolveHover('select', 1)).toBe(false);
    expect(shouldResolveHover('inspect', 2)).toBe(false);
    expect(shouldResolveHover('paint', 0)).toBe(false);
  });
});

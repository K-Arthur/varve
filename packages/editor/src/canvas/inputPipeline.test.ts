import { describe, expect, it } from 'vitest';
import { shouldResolveHover, shouldSkipCanvasKeydown } from './inputPipeline';

describe('canvas input hover policy', () => {
  it('resolves hover only for idle select and inspect pointers', () => {
    expect(shouldResolveHover('select', 0)).toBe(true);
    expect(shouldResolveHover('inspect', 0)).toBe(true);
    expect(shouldResolveHover('select', 1)).toBe(false);
    expect(shouldResolveHover('inspect', 2)).toBe(false);
    expect(shouldResolveHover('paint', 0)).toBe(false);
  });
});

describe('canvas IME composition guard', () => {
  it('skips keydowns while the IME is composing', () => {
    expect(shouldSkipCanvasKeydown({ isComposing: true })).toBe(true);
    expect(shouldSkipCanvasKeydown({ isComposing: true, keyCode: 65 })).toBe(true);
  });

  it('skips the keyCode 229 sentinel some engines report instead', () => {
    expect(shouldSkipCanvasKeydown({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(shouldSkipCanvasKeydown({ keyCode: 229 })).toBe(true);
  });

  it('lets ordinary keydowns through', () => {
    expect(shouldSkipCanvasKeydown({ isComposing: false, keyCode: 32 })).toBe(false);
    expect(shouldSkipCanvasKeydown({})).toBe(false);
  });
});

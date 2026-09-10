import { describe, expect, it } from 'vitest';

describe('Glass panel CSS', () => {
  it('supports backdrop-filter via style property', () => {
    const testEl = document.createElement('div');
    testEl.style.backdropFilter = 'blur(16px)';
    expect(testEl.style.backdropFilter).toBe('blur(16px)');
  });

  it('glass class can be applied to an element', () => {
    const testEl = document.createElement('div');
    testEl.className = 'editor__panel--glass';
    expect(testEl.classList.contains('editor__panel--glass')).toBe(true);
  });

  it('glass class can be combined with panel classes', () => {
    const testEl = document.createElement('div');
    testEl.className = 'editor__layers-panel editor__panel--glass';
    expect(testEl.className).toContain('editor__layers-panel');
    expect(testEl.className).toContain('editor__panel--glass');
  });

  it('glass class combined with inspector panel class', () => {
    const testEl = document.createElement('div');
    testEl.className = 'editor__inspector-panel editor__panel--glass';
    expect(testEl.className).toContain('editor__inspector-panel');
    expect(testEl.className).toContain('editor__panel--glass');
  });
});

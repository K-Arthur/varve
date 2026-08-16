// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adjustTransitionForAccessibility,
  announceToScreenReader,
  generateAriaLabel,
  getFocusableElements,
  MIN_ANIMATION_DURATION,
  prefersReducedMotion,
} from './accessibility';
import type { TransitionConfig } from './types';

const defaultTransition: TransitionConfig = {
  kind: 'dissolve',
  duration: 300,
  easing: { kind: 'linear' },
};

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe('prefersReducedMotion', () => {
  afterEach(() => {
    mockMatchMedia(false);
  });

  it('returns false when window is undefined (SSR guard)', () => {
    const win = globalThis.window;
    delete (globalThis as any).window;
    expect(prefersReducedMotion()).toBe(false);
    (globalThis as any).window = win;
  });

  it('returns false when matchMedia reports no preference', () => {
    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('returns true when matchMedia reports reduced motion', () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('adjustTransitionForAccessibility', () => {
  it('clamps duration to 0 when reduced motion is preferred', () => {
    const result = adjustTransitionForAccessibility(defaultTransition, true);
    expect(result.duration).toBe(0);
  });

  it('raises duration below minimum to MIN_ANIMATION_DURATION', () => {
    const fast: TransitionConfig = { ...defaultTransition, duration: 50 };
    const result = adjustTransitionForAccessibility(fast, false);
    expect(result.duration).toBe(MIN_ANIMATION_DURATION);
  });

  it('leaves duration unchanged when above minimum and not reduced', () => {
    const result = adjustTransitionForAccessibility(defaultTransition, false);
    expect(result.duration).toBe(300);
  });

  it('leaves duration at 0 when reduced motion is preferred and duration is 0', () => {
    const zero: TransitionConfig = { ...defaultTransition, duration: 0 };
    const result = adjustTransitionForAccessibility(zero, true);
    expect(result.duration).toBe(0);
  });

  it('preserves other transition properties when adjusting', () => {
    const result = adjustTransitionForAccessibility(defaultTransition, true);
    expect(result.kind).toBe('dissolve');
    expect(result.easing).toEqual({ kind: 'linear' });
  });

  it('uses prefersReducedMotion when no explicit value is given', () => {
    mockMatchMedia(true);
    const result = adjustTransitionForAccessibility(defaultTransition);
    expect(result.duration).toBe(0);
  });
});

describe('announceToScreenReader', () => {
  beforeEach(() => {
    const existing = document.getElementById('varve-prototype-announcer');
    if (existing) existing.remove();
  });

  afterEach(() => {
    const existing = document.getElementById('varve-prototype-announcer');
    if (existing) existing.remove();
  });

  it('creates an ARIA live region when one does not exist', () => {
    announceToScreenReader('Navigated to Screen 2', 'polite');
    const announcer = document.getElementById('varve-prototype-announcer');
    expect(announcer).not.toBeNull();
    expect(announcer?.getAttribute('aria-live')).toBe('polite');
    expect(announcer?.getAttribute('role')).toBe('status');
  });

  it('reuses an existing announcer element', () => {
    const existing = document.createElement('div');
    existing.id = 'varve-prototype-announcer';
    document.body.appendChild(existing);
    announceToScreenReader('Test', 'assertive');
    expect(document.getElementById('varve-prototype-announcer')).toBe(existing);
    expect(existing.getAttribute('aria-live')).toBe('assertive');
  });

  it('sets assertive priority when specified', () => {
    announceToScreenReader('Alert!', 'assertive');
    const announcer = document.getElementById('varve-prototype-announcer');
    expect(announcer?.getAttribute('aria-live')).toBe('assertive');
  });

  it('is a no-op when document is undefined (SSR guard)', () => {
    const doc = globalThis.document;
    delete (globalThis as any).document;
    expect(() => announceToScreenReader('test')).not.toThrow();
    (globalThis as any).document = doc;
  });
});

describe('generateAriaLabel', () => {
  it('generates label for onClick trigger', () => {
    const label = generateAriaLabel('Button 1', 'onClick', 'navigate to Screen 2');
    expect(label).toBe('Button 1. Click to navigate to Screen 2');
  });

  it('generates label for onHover trigger', () => {
    const label = generateAriaLabel('Card', 'onHover', 'show details');
    expect(label).toBe('Card. Hover to show details');
  });

  it('generates label for onTap trigger', () => {
    const label = generateAriaLabel('Icon', 'onTap', 'open menu');
    expect(label).toBe('Icon. Tap to open menu');
  });

  it('generates label for afterDelay trigger', () => {
    const label = generateAriaLabel('Slide', 'afterDelay', 'advance to next');
    expect(label).toBe('Slide. Auto to advance to next');
  });

  it('uses trigger type as label for unknown triggers', () => {
    const label = generateAriaLabel('X', 'onSwipe', 'go back');
    expect(label).toBe('X. onSwipe to go back');
  });
});

describe('getFocusableElements', () => {
  it('finds buttons that are not disabled', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="b1">Click</button>
      <button id="b2" disabled>Disabled</button>
      <a href="#" id="l1">Link</a>
    `;
    const elements = getFocusableElements(container);
    const ids = elements.map((el) => el.id);
    expect(ids).toContain('b1');
    expect(ids).toContain('l1');
    expect(ids).not.toContain('b2');
  });

  it('filters elements with display:none', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="visible">Show</button>
      <button id="hidden" style="display:none">Hidden</button>
    `;
    const elements = getFocusableElements(container);
    expect(elements.map((el) => el.id)).toEqual(['visible']);
  });

  it('filters elements with visibility:hidden', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="visible">Show</button>
      <button id="invisible" style="visibility:hidden">Invisible</button>
    `;
    const elements = getFocusableElements(container);
    expect(elements.map((el) => el.id)).toEqual(['visible']);
  });

  it('finds input, select, textarea elements', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <input id="inp" />
      <select id="sel"><option>1</option></select>
      <textarea id="ta"></textarea>
    `;
    const elements = getFocusableElements(container);
    const ids = elements.map((el) => el.id).sort();
    expect(ids).toEqual(['inp', 'sel', 'ta']);
  });

  it('finds elements with tabindex', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div id="tab1" tabindex="0">Focusable</div>
      <div id="tabNeg" tabindex="-1">Not focusable</div>
    `;
    const elements = getFocusableElements(container);
    expect(elements.map((el) => el.id)).toEqual(['tab1']);
  });

  it('returns empty array for container with no focusable elements', () => {
    const container = document.createElement('div');
    container.innerHTML = `<span>Not focusable</span>`;
    const elements = getFocusableElements(container);
    expect(elements).toHaveLength(0);
  });
});

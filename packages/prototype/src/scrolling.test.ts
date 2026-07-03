import { describe, expect, it } from 'vitest';
import {
  createScrollContainer,
  getScrollPosition,
  getVisibleBounds,
  isElementVisible,
  type ScrollState,
  setScrollPosition,
} from './scrolling';

describe('Scrolling system', () => {
  describe('createScrollContainer', () => {
    it('creates container with initial scroll at (0,0)', () => {
      const container = createScrollContainer('container-1', 400, 800);
      expect(container.id).toBe('container-1');
      expect(container.contentWidth).toBe(400);
      expect(container.contentHeight).toBe(800);
      expect(container.scrollX).toBe(0);
      expect(container.scrollY).toBe(0);
    });
  });

  describe('getScrollPosition / setScrollPosition', () => {
    it('gets and sets scroll position', () => {
      const state: ScrollState = {
        containers: {
          c1: createScrollContainer('c1', 400, 800, 200, 400),
        },
      };
      setScrollPosition(state, 'c1', 0, 100);
      const pos = getScrollPosition(state, 'c1');
      expect(pos).toEqual({ x: 0, y: 100 });
    });

    it('clamps scroll position to content bounds', () => {
      const state: ScrollState = {
        containers: {
          c1: createScrollContainer('c1', 400, 800, 200, 400),
        },
      };
      setScrollPosition(state, 'c1', -50, 900);
      const pos = getScrollPosition(state, 'c1');
      expect(pos?.x).toBe(0);
      expect(pos?.y).toBe(400); // clamped to (800-400)
    });

    it('returns null for unknown container', () => {
      const state: ScrollState = { containers: {} };
      expect(getScrollPosition(state, 'missing')).toBeNull();
    });
  });

  describe('isElementVisible', () => {
    it('element fully inside viewport is visible', () => {
      const state: ScrollState = {
        containers: {
          c1: createScrollContainer('c1', 400, 800, 200, 400),
        },
      };
      setScrollPosition(state, 'c1', 0, 0);
      expect(isElementVisible(state, 'c1', 50, 50, 100, 100)).toBe(true);
    });

    it('element scrolled above viewport is not visible', () => {
      const state: ScrollState = {
        containers: {
          c1: createScrollContainer('c1', 400, 1200, 200, 400),
        },
      };
      setScrollPosition(state, 'c1', 0, 500);
      // Element at y=300, h=100 [300,400] is fully above viewport [500,900]
      expect(isElementVisible(state, 'c1', 50, 300, 100, 100)).toBe(false);
    });

    it('element partially visible is still visible', () => {
      const state: ScrollState = {
        containers: {
          c1: createScrollContainer('c1', 400, 800, 200, 400),
        },
      };
      setScrollPosition(state, 'c1', 0, 350);
      // Element at y=300, h=200 — partially scrolled into view
      expect(isElementVisible(state, 'c1', 50, 300, 100, 200)).toBe(true);
    });
  });

  describe('getVisibleBounds', () => {
    it('returns visible rect based on scroll position', () => {
      const state: ScrollState = {
        containers: {
          c1: createScrollContainer('c1', 400, 800, 200, 400),
        },
      };
      setScrollPosition(state, 'c1', 50, 100);
      const bounds = getVisibleBounds(state, 'c1');
      expect(bounds).toEqual({ x: 50, y: 100, w: 200, h: 400 });
    });
  });
});

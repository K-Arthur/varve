/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  directionForAnchor,
  elementAnchor,
  ownerDocumentForAnchor,
  pagePoint,
  pageToViewport,
  pointAnchor,
  portalRootForAnchor,
  rangeAnchor,
  resolveCollisionRegion,
  resolvePlacementForDirection,
  safeViewportRect,
  viewportPoint,
  virtualPointReference,
  virtualRangeReference,
  visualViewportClampRect,
} from './overlayGeometry';

function withVisualViewport<T>(
  value:
    | { width: number; height: number; offsetTop: number; offsetLeft: number; scale: number }
    | undefined,
  run: () => T,
): T {
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value,
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else Reflect.deleteProperty(window, 'visualViewport');
  }
}

describe('overlay geometry contracts', () => {
  it('uses a usable padded intersection for a workspace collision boundary', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    const boundary = document.createElement('div');
    document.body.append(boundary);
    Object.defineProperty(boundary, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({
          left: 100,
          top: 120,
          right: 500,
          bottom: 420,
          width: 400,
          height: 300,
        }) as DOMRect,
    });

    const region = resolveCollisionRegion(document, boundary, 8);

    expect(region.boundary).toBe(boundary);
    expect(region.rect).toMatchObject({
      left: 108,
      top: 128,
      right: 492,
      bottom: 412,
      width: 384,
      height: 284,
    });
  });

  it.each([
    {
      name: 'a boundary too small for the padding',
      rect: { left: 100, top: 100, right: 112, bottom: 300, width: 12, height: 200 },
    },
    {
      name: 'a boundary outside the visible viewport',
      rect: { left: 1200, top: 900, right: 1400, bottom: 1100, width: 200, height: 200 },
    },
  ])('falls back to the viewport for $name', ({ rect: bounds }) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    const boundary = document.createElement('div');
    document.body.append(boundary);
    Object.defineProperty(boundary, 'getBoundingClientRect', {
      configurable: true,
      value: () => bounds as DOMRect,
    });

    const region = resolveCollisionRegion(document, boundary, 8);

    expect(region.boundary).toBeUndefined();
    expect(region.rect).toEqual(visualViewportClampRect(document, 8));
    expect(region.rect.width).toBeGreaterThan(0);
    expect(region.rect.height).toBeGreaterThan(0);
  });

  it('uses the full available viewport when the safe-area inset exceeds its size', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 12 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 10 });

    const region = resolveCollisionRegion(document, document.createElement('div'), 8);

    expect(region.boundary).toBeUndefined();
    expect(region.rect.width).toBe(12);
    expect(region.rect.height).toBe(10);
  });

  it('tags client coordinates as viewport coordinates', () => {
    expect(viewportPoint(12, 34)).toEqual({ space: 'viewport', x: 12, y: 34 });
    expect(() => viewportPoint(Number.NaN, 1)).toThrow(RangeError);
    expect(() => viewportPoint(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('creates a zero-size point reference and preserves its context element', () => {
    const contextElement = document.createElement('div');
    document.body.append(contextElement);
    const anchor = pointAnchor(viewportPoint(120, 240), document, contextElement);
    const reference = virtualPointReference(anchor);
    const rect = reference.getBoundingClientRect();

    expect(rect.left).toBe(120);
    expect(rect.top).toBe(240);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
    expect(reference.contextElement).toBe(contextElement);
  });

  it('keeps page coordinates out of fixed overlays until explicitly converted', () => {
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 12 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 34 });
    const page = pagePoint(112, 234);

    expect(pageToViewport(page, document)).toEqual({ space: 'viewport', x: 100, y: 200 });
  });

  it('adapts a range anchor and keeps its owner document', () => {
    const text = document.createTextNode('selection');
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 24, top: 48, right: 96, bottom: 72, width: 72, height: 24 }),
    });
    const anchor = rangeAnchor(range);
    const reference = virtualRangeReference(anchor);

    expect(ownerDocumentForAnchor(anchor)).toBe(document);
    expect(reference.getBoundingClientRect()).toMatchObject({
      left: 24,
      top: 48,
      width: 72,
      height: 24,
    });
  });

  it('keeps element anchors in their owner document and dialog root', () => {
    const dialog = document.createElement('dialog');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    const anchor = elementAnchor(button);

    expect(ownerDocumentForAnchor(anchor)).toBe(document);
    expect(portalRootForAnchor(document, anchor)).toBe(dialog);
  });

  it('returns a nonnegative viewport-safe rectangle', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 4 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 3 });
    const safe = safeViewportRect(document, 8);

    expect(safe.left).toBeLessThanOrEqual(safe.right);
    expect(safe.top).toBeLessThanOrEqual(safe.bottom);
    expect(safe.width).toBeGreaterThanOrEqual(0);
    expect(safe.height).toBeGreaterThanOrEqual(0);
  });

  it('maps horizontal submenu placement to logical inline-end in RTL', () => {
    const trigger = document.createElement('button');
    trigger.style.direction = 'rtl';
    document.body.append(trigger);

    expect(directionForAnchor(elementAnchor(trigger), document)).toBe('rtl');
    expect(resolvePlacementForDirection('right-start', 'rtl', true)).toBe('left-start');
    expect(resolvePlacementForDirection('left-start', 'rtl', true)).toBe('right-start');
    expect(resolvePlacementForDirection('right-start', 'rtl')).toBe('right-start');
  });

  it('produces finite, nonnegative safe rectangles across small viewports', () => {
    for (let i = 0; i < 100; i += 1) {
      const width = (i * 137) % 2048;
      const height = (i * 83) % 1024;
      const padding = (i * 19) % 64;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      const safe = safeViewportRect(document, padding);
      expect([safe.left, safe.right, safe.top, safe.bottom].every(Number.isFinite)).toBe(true);
      expect(safe.width).toBeGreaterThanOrEqual(0);
      expect(safe.height).toBeGreaterThanOrEqual(0);
      expect(safe.right).toBeGreaterThanOrEqual(safe.left);
      expect(safe.bottom).toBeGreaterThanOrEqual(safe.top);
    }
  });

  it('falls back to the layout viewport when visualViewport is unavailable', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    const rect = visualViewportClampRect(document, 8);
    expect(rect.width).toBe(1008);
    expect(rect.height).toBe(752);
  });

  it('constrains to the visual viewport when the keyboard shrinks it', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    withVisualViewport({ width: 1024, height: 420, offsetTop: 0, offsetLeft: 0, scale: 1 }, () => {
      const rect = visualViewportClampRect(document, 8);
      expect(rect.width).toBe(1008);
      expect(rect.height).toBe(404);
      expect(rect.bottom).toBe(412);
    });
  });

  it('includes visual viewport offsets when the keyboard pans the visible region', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    withVisualViewport(
      { width: 600, height: 500, offsetTop: 80, offsetLeft: 120, scale: 1 },
      () => {
        const rect = visualViewportClampRect(document, 8);
        expect(rect).toMatchObject({
          left: 128,
          top: 88,
          right: 712,
          bottom: 572,
          width: 584,
          height: 484,
        });
      },
    );
  });

  it('keeps the layout fallback while the page is pinch-zoomed', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    withVisualViewport({ width: 512, height: 384, offsetTop: 40, offsetLeft: 30, scale: 2 }, () => {
      const rect = visualViewportClampRect(document, 8);
      expect(rect.width).toBe(1008);
      expect(rect.bottom).toBe(760);
    });
  });
});

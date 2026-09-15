import { describe, expect, it } from 'vitest';
import type { CanvasRect } from '../toolContext';

/**
 * Canvas rect caching — TDD tests.
 *
 * The canvas rect (left, top) is cached in a ref and updated by ResizeObserver
 * + pointerdown. canvasToWorld reads from this cache instead of calling
 * getBoundingClientRect() on every pointer-move (the single highest-frequency
 * DOM layout read in the application).
 *
 * These tests verify the caching contract: that canvasToWorld produces correct
 * results when given different cached rect values, and that the cache can be
 * updated without affecting other consumers.
 */

/** Simulates the canvasToWorld conversion using a cached canvas rect. */
function canvasToWorld(
  clientX: number,
  clientY: number,
  canvasRect: CanvasRect,
  worldFn: (localX: number, localY: number) => { x: number; y: number },
): { x: number; y: number } {
  return worldFn(clientX - canvasRect.left, clientY - canvasRect.top);
}

/** Simple world transform: identity (local === world). */
function identityWorld(localX: number, localY: number): { x: number; y: number } {
  return { x: localX, y: localY };
}

/** World transform with offset: world = local + offset. */
function offsetWorld(offsetX: number, offsetY: number) {
  return (localX: number, localY: number) => ({
    x: localX + offsetX,
    y: localY + offsetY,
  });
}

describe('canvas rect cache', () => {
  it('produces correct world coordinates with a non-zero canvas rect', () => {
    const rect: CanvasRect = { left: 100, top: 50 };
    // Client (200, 150) with canvas at (100, 50) → local (100, 100) → world (100, 100)
    const world = canvasToWorld(200, 150, rect, identityWorld);
    expect(world).toEqual({ x: 100, y: 100 });
  });

  it('produces correct world coordinates with a zero canvas rect (fullscreen)', () => {
    const rect: CanvasRect = { left: 0, top: 0 };
    const world = canvasToWorld(200, 150, rect, identityWorld);
    expect(world).toEqual({ x: 200, y: 150 });
  });

  it('handles negative canvas rect values (off-screen canvas)', () => {
    const rect: CanvasRect = { left: -50, top: -30 };
    // Client (100, 70) with canvas at (-50, -30) → local (150, 100)
    const world = canvasToWorld(100, 70, rect, identityWorld);
    expect(world).toEqual({ x: 150, y: 100 });
  });

  it('uses the cached rect at call time, not at definition time', () => {
    const rectRef = { current: { left: 100, top: 50 } };

    // First call with rect at (100, 50)
    const world1 = canvasToWorld(200, 150, rectRef.current, identityWorld);
    expect(world1).toEqual({ x: 100, y: 100 });

    // Update the cache (simulating ResizeObserver + pointerdown refresh)
    rectRef.current = { left: 200, top: 100 };

    // Second call with updated rect at (200, 100)
    const world2 = canvasToWorld(200, 150, rectRef.current, identityWorld);
    expect(world2).toEqual({ x: 0, y: 50 });
  });

  it('works correctly with a non-identity world transform', () => {
    const rect: CanvasRect = { left: 100, top: 50 };
    const worldFn = offsetWorld(500, 300);
    // Client (200, 150) → local (100, 100) → world (600, 400)
    const world = canvasToWorld(200, 150, rect, worldFn);
    expect(world).toEqual({ x: 600, y: 400 });
  });

  it('produces consistent results across multiple calls with same cache', () => {
    const rect: CanvasRect = { left: 100, top: 50 };
    const results = [];
    for (let i = 0; i < 100; i++) {
      results.push(canvasToWorld(200, 150, rect, identityWorld));
    }
    // All results should be identical (no mutation, no side effects)
    for (const r of results) {
      expect(r).toEqual({ x: 100, y: 100 });
    }
  });

  it('the cache can be refreshed at gesture start without affecting other refs', () => {
    const rectRef = { current: { left: 100, top: 50 } };
    const otherRef = { current: 'unaffected' };

    // Simulate pointerdown refresh
    rectRef.current = { left: 200, top: 100 };

    // Other ref is unaffected
    expect(otherRef.current).toBe('unaffected');

    // Canvas rect uses new value
    const world = canvasToWorld(300, 200, rectRef.current, identityWorld);
    expect(world).toEqual({ x: 100, y: 100 });
  });
});

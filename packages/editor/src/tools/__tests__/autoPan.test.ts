import { describe, expect, it } from 'vitest';
import { computeEdgeVelocity, EDGE_SCROLL_MAX_SPEED, EDGE_SCROLL_ZONE } from '../autoPan';

describe('computeEdgeVelocity', () => {
  const canvasLeft = 0;
  const canvasRight = 1000;
  const canvasTop = 0;
  const canvasBottom = 800;

  it('returns negative velocity near left edge', () => {
    const v = computeEdgeVelocity(10, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(v).toBeLessThan(0);
  });

  it('returns positive velocity near right edge', () => {
    const v = computeEdgeVelocity(990, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(v).toBeGreaterThan(0);
  });

  it('returns negative velocity near top edge', () => {
    const v = computeEdgeVelocity(10, canvasTop, canvasBottom, EDGE_SCROLL_ZONE);
    expect(v).toBeLessThan(0);
  });

  it('returns positive velocity near bottom edge', () => {
    const v = computeEdgeVelocity(790, canvasTop, canvasBottom, EDGE_SCROLL_ZONE);
    expect(v).toBeGreaterThan(0);
  });

  it('returns zero when not in scroll zone', () => {
    const v = computeEdgeVelocity(500, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(v).toBe(0);
  });

  it('returns max speed at exact edge', () => {
    const v = computeEdgeVelocity(0, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(v).toBe(-EDGE_SCROLL_MAX_SPEED);
  });

  it('returns max speed at exact opposite edge', () => {
    const v = computeEdgeVelocity(1000, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(v).toBe(EDGE_SCROLL_MAX_SPEED);
  });

  it('stays bounded when pointer capture carries a drag outside the canvas', () => {
    expect(computeEdgeVelocity(-100, canvasLeft, canvasRight)).toBe(-EDGE_SCROLL_MAX_SPEED);
    expect(computeEdgeVelocity(1100, canvasLeft, canvasRight)).toBe(EDGE_SCROLL_MAX_SPEED);
  });

  it('velocity increases as pointer approaches edge (left)', () => {
    const near = computeEdgeVelocity(5, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    const far = computeEdgeVelocity(35, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far));
  });

  it('velocity increases as pointer approaches edge (right)', () => {
    const near = computeEdgeVelocity(995, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    const far = computeEdgeVelocity(965, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far));
  });

  it('returns zero when pos is exactly at zone boundary', () => {
    const v = computeEdgeVelocity(40, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(v).toBe(0);
  });

  it('returns zero for pos exactly at opposite zone boundary', () => {
    const v = computeEdgeVelocity(960, canvasLeft, canvasRight, EDGE_SCROLL_ZONE);
    expect(v).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  leftRulerScreenToWorld,
  projectWorldXToTopEdge,
  projectWorldYToLeftEdge,
  topRulerScreenToWorld,
  visibleWorldSpanOnRulerEdge,
} from './rulerGeometry';

const viewport = { width: 800, height: 600 };

describe('rulerGeometry', () => {
  it('projects world X to a stable top-edge screen position at zero rotation', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    const sx = projectWorldXToTopEdge(100, cam, viewport);
    expect(sx).toBeCloseTo(100, 0);
  });

  it('top ruler screen position maps back to world X at zero rotation', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    const [wx] = topRulerScreenToWorld(150, cam, viewport);
    expect(wx).toBeCloseTo(150, 0);
  });

  it('left ruler screen position maps back to world Y at zero rotation', () => {
    const cam = { zoom: 2, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    const [, wy] = leftRulerScreenToWorld(120, cam, viewport);
    expect(wy).toBeCloseTo(60, 0);
  });

  it('world X tick moves along top edge when view is rotated', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: Math.PI / 6 };
    const sx = projectWorldXToTopEdge(200, cam, viewport);
    expect(sx).not.toBeNull();
    expect(sx).not.toBeCloseTo(200, 0);
  });

  it('world Y tick projects to left edge when view is rotated', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: Math.PI / 6 };
    const sy = projectWorldYToLeftEdge(200, cam, viewport);
    expect(sy).not.toBeNull();
  });

  it('visible world span covers viewport corners', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    const span = visibleWorldSpanOnRulerEdge('horizontal', cam, viewport);
    expect(span.max - span.min).toBeGreaterThan(400);
  });
});

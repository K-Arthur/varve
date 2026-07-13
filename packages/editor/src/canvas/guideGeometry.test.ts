import { describe, expect, it } from 'vitest';
import {
  distanceSqToGuideLine,
  guideLineScreenEndpoints,
  screenToGuidePosition,
} from './guideGeometry';

const viewport = { width: 800, height: 600 };

describe('guideGeometry', () => {
  it('vertical guide is axis-aligned on screen when rotation is 0', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    const line = guideLineScreenEndpoints({ axis: 'vertical', position: 100 }, cam, viewport);
    expect(line.x1).toBeCloseTo(line.x2, 0);
    expect(line.y1).not.toBeCloseTo(line.y2, 0);
  });

  it('vertical guide tilts on screen when view is rotated', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: Math.PI / 4 };
    const line = guideLineScreenEndpoints({ axis: 'vertical', position: 100 }, cam, viewport);
    expect(Math.abs(line.x2 - line.x1)).toBeGreaterThan(1);
    expect(Math.abs(line.y2 - line.y1)).toBeGreaterThan(1);
  });

  it('screenToGuidePosition maps screen X for vertical guides at zero rotation', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    const pos = screenToGuidePosition({ axis: 'vertical', position: 0 }, 150, 200, cam, viewport);
    expect(pos).toBeCloseTo(150, 0);
  });

  it('distanceSqToGuideLine is zero on the guide', () => {
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    const guide = { axis: 'vertical' as const, position: 200 };
    const line = guideLineScreenEndpoints(guide, cam, viewport);
    const midY = (line.y1 + line.y2) / 2;
    const dist = distanceSqToGuideLine(guide, cam, viewport, line.x1, midY);
    expect(dist).toBeLessThan(1);
  });
});

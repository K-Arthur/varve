import { describe, expect, it } from 'vitest';
import { captureViewport, DEFAULT_SAVED_VIEWPORT, normalizeSavedViewport } from './viewportSession';

describe('viewportSession', () => {
  const source = {
    zoom: 2,
    pan: { x: 100, y: 50 },
    cameraRotation: 0.5,
    snapEnabled: false,
    pixelGridEnabled: true,
    pixelGridSnapEnabled: false,
    dotGridEnabled: false,
    rulerMode: 'global' as const,
    gridOverlayMode: 'baseline' as const,
    unitType: 'mm' as const,
    guidesVisible: false,
    snapGrid: 16,
    gridVisible: false,
    bleedGuidesVisible: false,
    layoutGridVisible: false,
  };

  it('captureViewport copies all fields', () => {
    const snap = captureViewport(source);
    expect(snap).toEqual(source);
    expect(snap.pan).not.toBe(source.pan);
  });

  it('normalizeSavedViewport fills legacy zoom/pan-only snapshots', () => {
    const legacy = normalizeSavedViewport({ zoom: 3, pan: { x: 10, y: 20 } });
    expect(legacy.zoom).toBe(3);
    expect(legacy.pan).toEqual({ x: 10, y: 20 });
    expect(legacy.cameraRotation).toBe(DEFAULT_SAVED_VIEWPORT.cameraRotation);
    expect(legacy.snapEnabled).toBe(DEFAULT_SAVED_VIEWPORT.snapEnabled);
    expect(legacy.guidesVisible).toBe(DEFAULT_SAVED_VIEWPORT.guidesVisible);
    expect(legacy.snapGrid).toBe(DEFAULT_SAVED_VIEWPORT.snapGrid);
  });

  it('normalizeSavedViewport returns defaults for undefined', () => {
    expect(normalizeSavedViewport(undefined)).toEqual(DEFAULT_SAVED_VIEWPORT);
  });
});

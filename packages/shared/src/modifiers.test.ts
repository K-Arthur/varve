import { describe, expect, it } from 'vitest';
import { computeResizeModifiers, computeRotateModifiers } from './modifiers';

describe('computeResizeModifiers', () => {
  describe('raster (image) nodes — default proportional ON', () => {
    it('defaults proportional=true for raster without modifiers', () => {
      const m = computeResizeModifiers(false, false, false, false, true);
      expect(m.proportional).toBe(true);
      expect(m.centered).toBe(false);
      expect(m.bypassSnap).toBe(false);
    });

    it('Shift toggles proportional OFF for raster', () => {
      const m = computeResizeModifiers(true, false, false, false, true);
      expect(m.proportional).toBe(false);
    });

    it('uses an edge handle to resize the image container without scaling both axes', () => {
      const m = computeResizeModifiers(false, false, false, false, true, false, true);
      expect(m.proportional).toBe(false);
    });

    it('Shift constrains a raster edge resize proportionally', () => {
      const m = computeResizeModifiers(true, false, false, false, true, false, true);
      expect(m.proportional).toBe(true);
    });

    it('Alt sets centered=true', () => {
      const m = computeResizeModifiers(false, true, false, false, true);
      expect(m.centered).toBe(true);
    });

    it('Ctrl sets bypassSnap=true', () => {
      const m = computeResizeModifiers(false, false, true, false, true);
      expect(m.bypassSnap).toBe(true);
    });

    it('Shift+Alt combines toggle and center', () => {
      const m = computeResizeModifiers(true, true, false, false, true);
      expect(m.proportional).toBe(false);
      expect(m.centered).toBe(true);
    });
  });

  describe('non-raster nodes — default proportional OFF', () => {
    it('defaults proportional=false for vector without modifiers', () => {
      const m = computeResizeModifiers(false, false, false, false, false);
      expect(m.proportional).toBe(false);
      expect(m.centered).toBe(false);
      expect(m.bypassSnap).toBe(false);
    });

    it('Shift sets proportional ON for vector', () => {
      const m = computeResizeModifiers(true, false, false, false, false);
      expect(m.proportional).toBe(true);
    });

    it('Alt sets centered=true', () => {
      const m = computeResizeModifiers(false, true, false, false, false);
      expect(m.centered).toBe(true);
    });
  });

  describe('macOS Cmd key handling', () => {
    it('uses metaKey for bypassSnap on macOS', () => {
      const m = computeResizeModifiers(false, false, false, true, false, true);
      expect(m.bypassSnap).toBe(true);
    });

    it('does NOT use ctrlKey for bypassSnap on macOS', () => {
      const m = computeResizeModifiers(false, false, true, false, false, true);
      expect(m.bypassSnap).toBe(false);
    });
  });

  describe('multi-selection', () => {
    it('respects isRaster=true when all selected are images', () => {
      const m = computeResizeModifiers(false, false, false, false, true);
      expect(m.proportional).toBe(true);
    });

    it('respects isRaster=false when selection includes vectors', () => {
      const m = computeResizeModifiers(false, false, false, false, false);
      expect(m.proportional).toBe(false);
    });
  });

  describe('explicit defaultProportional parameter', () => {
    it('uses defaultProportional=true when provided and no Shift', () => {
      const m = computeResizeModifiers(false, false, false, false, true, false, false, true);
      expect(m.proportional).toBe(true);
    });

    it('Shift toggles OFF when defaultProportional=true', () => {
      const m = computeResizeModifiers(true, false, false, false, true, false, false, true);
      expect(m.proportional).toBe(false);
    });

    it('uses defaultProportional=false when provided and no Shift', () => {
      const m = computeResizeModifiers(false, false, false, false, true, false, false, false);
      expect(m.proportional).toBe(false);
    });

    it('Shift toggles ON when defaultProportional=false', () => {
      const m = computeResizeModifiers(true, false, false, false, true, false, false, false);
      expect(m.proportional).toBe(true);
    });

    it('defaultProportional takes precedence over isRaster heuristic', () => {
      const m = computeResizeModifiers(false, false, false, false, true, false, false, false);
      expect(m.proportional).toBe(false);
    });
  });
});

describe('computeRotateModifiers', () => {
  it('Shift snaps rotation', () => {
    const m = computeRotateModifiers(true);
    expect(m.snap).toBe(true);
  });

  it('default rotation has no snap', () => {
    const m = computeRotateModifiers(false);
    expect(m.snap).toBe(false);
  });
});

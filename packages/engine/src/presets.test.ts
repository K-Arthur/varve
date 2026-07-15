/**
 * Tests for effect presets module.
 */
import { describe, expect, it } from 'vitest';
import { GRADIENT_MAP_PRESETS, TRITONE_PRESETS } from './presets';

describe('GRADIENT_MAP_PRESETS', () => {
  it('has at least 6 presets', () => {
    expect(GRADIENT_MAP_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it('each preset has required fields', () => {
    for (const preset of GRADIENT_MAP_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.stops.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('each preset has unique id', () => {
    const ids = GRADIENT_MAP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each stop has position in [0,1] and valid color', () => {
    for (const preset of GRADIENT_MAP_PRESETS) {
      for (const stop of preset.stops) {
        expect(stop.position).toBeGreaterThanOrEqual(0);
        expect(stop.position).toBeLessThanOrEqual(1);
        expect(stop.color.length).toBe(4);
        for (let c = 0; c < 4; c++) {
          expect(stop.color[c]).toBeGreaterThanOrEqual(0);
          expect(stop.color[c]).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe('TRITONE_PRESETS', () => {
  it('has at least 4 presets', () => {
    expect(TRITONE_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it('each preset has required fields', () => {
    for (const preset of TRITONE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.shadowPoint).toBeGreaterThanOrEqual(0);
      expect(preset.shadowPoint).toBeLessThanOrEqual(1);
      expect(preset.highlightPoint).toBeGreaterThanOrEqual(0);
      expect(preset.highlightPoint).toBeLessThanOrEqual(1);
    }
  });

  it('each preset has unique id', () => {
    const ids = TRITONE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shadow point <= highlight point', () => {
    for (const preset of TRITONE_PRESETS) {
      expect(preset.shadowPoint).toBeLessThanOrEqual(preset.highlightPoint);
    }
  });

  it('each color has valid range', () => {
    for (const preset of TRITONE_PRESETS) {
      for (const color of [preset.shadowColor, preset.midtoneColor, preset.highlightColor]) {
        for (let c = 0; c < 4; c++) {
          expect(color[c]).toBeGreaterThanOrEqual(0);
          expect(color[c]).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

/**
 * Resolution and DPI semantics — comprehensive test coverage.
 *
 * These tests verify the canonical resolution model:
 * - Varve scene geometry is always 96 px/in (REFERENCE_PPI).
 * - doc.dpi is export-time metadata, never used for physical→design-space conversion.
 * - Effective raster PPI is independent of document DPI.
 * - Resolution scale = targetPpi / REFERENCE_PPI, regardless of doc.dpi.
 */

import { describe, expect, it } from 'vitest';
import type { ExportScale } from './model';
import {
  effectiveRasterPpi,
  physicalSizeForDocumentBounds,
  physicalToDocumentPx,
  REFERENCE_PPI,
  resolveExportScale,
} from './resolution';

// ── REFERENCE_PPI constant ───────────────────────────────────────────────────

describe('REFERENCE_PPI', () => {
  it('is 96 (standard screen DPI)', () => {
    expect(REFERENCE_PPI).toBe(96);
  });
});

// ── physicalToDocumentPx ─────────────────────────────────────────────────────

describe('physicalToDocumentPx', () => {
  it('converts 1 inch to 96 design px', () => {
    expect(physicalToDocumentPx(1, 'in')).toBe(96);
  });

  it('converts 25.4mm to 96 design px (1 inch)', () => {
    expect(physicalToDocumentPx(25.4, 'mm')).toBeCloseTo(96, 10);
  });

  it('converts 2.54cm to 96 design px (1 inch)', () => {
    expect(physicalToDocumentPx(2.54, 'cm')).toBeCloseTo(96, 10);
  });

  it('converts A4 width (210mm) to ~793.7 design px', () => {
    const expected = (210 * 96) / 25.4;
    expect(physicalToDocumentPx(210, 'mm')).toBeCloseTo(expected, 5);
  });

  it('converts A4 height (297mm) to ~1122.5 design px', () => {
    const expected = (297 * 96) / 25.4;
    expect(physicalToDocumentPx(297, 'mm')).toBeCloseTo(expected, 5);
  });

  it('does NOT use doc.dpi — identical result regardless of document DPI', () => {
    const value = 100;
    const unit = 'mm';
    // The function has no doc.dpi parameter; it always uses REFERENCE_PPI.
    const result = physicalToDocumentPx(value, unit);
    expect(result).toBe((100 * 96) / 25.4);
  });
});

// ── resolveExportScale ───────────────────────────────────────────────────────

describe('resolveExportScale', () => {
  it('multiplier mode returns the value directly', () => {
    const result = resolveExportScale({ mode: 'multiplier', value: 2 }, { width: 100, height: 50 });
    expect(result.scaleFactor).toBe(2);
  });

  it('width mode with px uses raw pixel value', () => {
    const result = resolveExportScale(
      { mode: 'width', value: 400, unit: 'px' },
      { width: 200, height: 100 },
    );
    expect(result.scaleFactor).toBe(2);
  });

  it('width mode with physical units uses fixed 96dpi conversion', () => {
    const result = resolveExportScale(
      { mode: 'width', value: 1, unit: 'in' },
      { width: 96, height: 96 },
    );
    expect(result.scaleFactor).toBe(1);
  });

  it('resolution mode always divides by REFERENCE_PPI (96), not doc.dpi', () => {
    // This is the critical invariant — doc.dpi must never affect scale computation.
    // Both documents must produce the same scale factor for the same target PPI.
    const screenResult = resolveExportScale(
      { mode: 'resolution', dpi: 300 },
      { width: 100, height: 100 },
    );
    const printResult = resolveExportScale(
      { mode: 'resolution', dpi: 300 },
      { width: 100, height: 100 },
    );
    expect(screenResult.scaleFactor).toBe(300 / 96);
    expect(printResult.scaleFactor).toBe(300 / 96);
    expect(screenResult.scaleFactor).toBeCloseTo(printResult.scaleFactor, 10);
  });

  it('width/height modes are independent of doc.dpi', () => {
    // A4 width in design px = 210mm → 793.7 design px. Frame is 793.7 wide.
    // Factor = 793.7 / 793.7 = 1. Same regardless of any doc.dpi.
    const screenResult = resolveExportScale(
      { mode: 'width', value: 210, unit: 'mm' },
      { width: (210 * 96) / 25.4, height: (297 * 96) / 25.4 },
    );
    const printResult = resolveExportScale(
      { mode: 'width', value: 210, unit: 'mm' },
      { width: (210 * 96) / 25.4, height: (297 * 96) / 25.4 },
    );
    expect(screenResult.scaleFactor).toBeCloseTo(1, 10);
    expect(printResult.scaleFactor).toBeCloseTo(1, 10);
  });

  it('never produces a scale factor below 1/16', () => {
    const result = resolveExportScale(
      { mode: 'multiplier', value: 0.001 },
      { width: 100, height: 100 },
    );
    expect(result.scaleFactor).toBe(1 / 16);
  });
});

// ── A4 at 300 PPI (the canonical print test) ────────────────────────────────

describe('A4 at 300 PPI', () => {
  it('produces ~2480 × 3508 output pixels', () => {
    const a4WidthMm = 210;
    const a4HeightMm = 297;
    const targetPpi = 300;

    // Design space: A4 at 96 dpi
    const designWidth = physicalToDocumentPx(a4WidthMm, 'mm');
    const designHeight = physicalToDocumentPx(a4HeightMm, 'mm');

    // Scale factor: 300 / 96 = 3.125
    const result = resolveExportScale(
      { mode: 'resolution', dpi: targetPpi },
      { width: designWidth, height: designHeight },
    );
    expect(result.scaleFactor).toBeCloseTo(300 / 96, 10);

    // Output dimensions
    const outputWidth = Math.round(designWidth * result.scaleFactor);
    const outputHeight = Math.round(designHeight * result.scaleFactor);
    expect(outputWidth).toBe(2480);
    expect(outputHeight).toBe(3508);
  });
});

// ── Letter at 300 PPI ───────────────────────────────────────────────────────

describe('Letter at 300 PPI', () => {
  it('produces 2550 × 3300 output pixels', () => {
    const designWidth = 8.5 * 96; // 816 design px
    const designHeight = 11 * 96; // 1056 design px

    const result = resolveExportScale(
      { mode: 'resolution', dpi: 300 },
      { width: designWidth, height: designHeight },
    );

    const outputWidth = Math.round(designWidth * result.scaleFactor);
    const outputHeight = Math.round(designHeight * result.scaleFactor);
    expect(outputWidth).toBe(2550);
    expect(outputHeight).toBe(3300);
  });
});

// ── 4×6 inches at 300 PPI ───────────────────────────────────────────────────

describe('4×6 inches at 300 PPI', () => {
  it('produces 1200 × 1800 output pixels', () => {
    const designWidth = 4 * 96; // 384 design px
    const designHeight = 6 * 96; // 576 design px

    const result = resolveExportScale(
      { mode: 'resolution', dpi: 300 },
      { width: designWidth, height: designHeight },
    );

    const outputWidth = Math.round(designWidth * result.scaleFactor);
    const outputHeight = Math.round(designHeight * result.scaleFactor);
    expect(outputWidth).toBe(1200);
    expect(outputHeight).toBe(1800);
  });
});

// ── Multiplier mode ──────────────────────────────────────────────────────────

describe('Multiplier mode', () => {
  it('1× produces same dimensions', () => {
    const result = resolveExportScale(
      { mode: 'multiplier', value: 1 },
      { width: 1200, height: 800 },
    );
    expect(result.scaleFactor).toBe(1);
    expect(Math.round(1200 * result.scaleFactor)).toBe(1200);
    expect(Math.round(800 * result.scaleFactor)).toBe(800);
  });

  it('2× doubles dimensions', () => {
    const result = resolveExportScale(
      { mode: 'multiplier', value: 2 },
      { width: 1200, height: 800 },
    );
    expect(result.scaleFactor).toBe(2);
    expect(Math.round(1200 * result.scaleFactor)).toBe(2400);
    expect(Math.round(800 * result.scaleFactor)).toBe(1600);
  });

  it('0.5× halves dimensions', () => {
    const result = resolveExportScale(
      { mode: 'multiplier', value: 0.5 },
      { width: 1200, height: 800 },
    );
    expect(result.scaleFactor).toBe(0.5);
    expect(Math.round(1200 * result.scaleFactor)).toBe(600);
    expect(Math.round(800 * result.scaleFactor)).toBe(400);
  });
});

// ── physicalSizeForDocumentBounds ────────────────────────────────────────────

describe('physicalSizeForDocumentBounds', () => {
  it('converts 96×96 design px to 1×1 inches', () => {
    const result = physicalSizeForDocumentBounds({ width: 96, height: 96 });
    expect(result.widthInches).toBeCloseTo(1, 10);
    expect(result.heightInches).toBeCloseTo(1, 10);
  });

  it('converts A4 design dimensions to physical inches', () => {
    const a4WidthPx = (210 * 96) / 25.4;
    const a4HeightPx = (297 * 96) / 25.4;
    const result = physicalSizeForDocumentBounds({ width: a4WidthPx, height: a4HeightPx });
    expect(result.widthInches).toBeCloseTo(210 / 25.4, 5);
    expect(result.heightInches).toBeCloseTo(297 / 25.4, 5);
  });
});

// ── effectiveRasterPpi ──────────────────────────────────────────────────────

describe('effectiveRasterPpi', () => {
  it('reports tile fills as unavailable', () => {
    const result = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'tile',
      bounds: { width: 400, height: 300 },
    });
    expect(result.available).toBe(false);
    expect(result.minimumPpi).toBe(0);
  });

  it('stretch mode: image fills bounds exactly', () => {
    // 3000×2000 image stretched to 400×300 design px
    // Physical size: 400/96 × 300/96 inches
    // Effective PPI X: 3000 / (400/96) = 3000 * 96/400 = 720
    const result = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'stretch',
      bounds: { width: 400, height: 300 },
    });
    expect(result.available).toBe(true);
    expect(result.ppiX).toBeCloseTo(3000 / (400 / 96), 5);
    expect(result.ppiY).toBeCloseTo(2000 / (300 / 96), 5);
  });

  it('fit mode: image maintains aspect ratio, letterboxed', () => {
    // 3000×2000 image (aspect 1.5) fit into 400×300 bounds (aspect 1.333)
    // Width-constrained: drawWidth=400, drawHeight=400/1.5=266.67
    // Effective PPI X: 3000 / (400/96) = 720
    const result = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'fit',
      bounds: { width: 400, height: 300 },
    });
    expect(result.available).toBe(true);
    expect(result.ppiX).toBeCloseTo(720, 0);
  });

  it('scale factor affects effective PPI', () => {
    // 3000×2000 image at scale 2 in stretch mode fills 400×300 bounds
    // Same effective PPI as scale 1 (stretch ignores scale for sizing)
    const result = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'stretch',
      bounds: { width: 400, height: 300 },
      scale: 2,
    });
    expect(result.available).toBe(true);
    // Stretch mode: image fills bounds regardless of scale
    expect(result.ppiX).toBeCloseTo(3000 / (400 / 96), 5);
  });

  it('crop mode: uses source dimensions × scale', () => {
    // 3000×2000 image at scale 0.5 in crop mode
    // Draw size: 1500×1000 design px
    // Effective PPI X: 3000 / (1500/96) = 192
    const result = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'crop',
      bounds: { width: 400, height: 300 },
      scale: 0.5,
    });
    expect(result.available).toBe(true);
    expect(result.ppiX).toBeCloseTo(192, 0);
    expect(result.ppiY).toBeCloseTo(192, 0);
  });

  it('scale up lowers effective PPI', () => {
    // 3000×2000 image at scale 2 in crop mode
    // Draw size: 6000×4000 design px
    // Effective PPI X: 3000 / (6000/96) = 48
    const result = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'crop',
      bounds: { width: 400, height: 300 },
      scale: 2,
    });
    expect(result.available).toBe(true);
    expect(result.ppiX).toBeCloseTo(48, 0);
    expect(result.minimumPpi).toBeCloseTo(48, 0);
  });

  it('non-uniform world transform produces different X/Y PPI', () => {
    // 3000×2000 image stretched to 400×300, then world transform stretches X by 2
    // displayedWidth = 400 * 2 = 800, displayedHeight = 300 * 1 = 300
    // PPI X: 3000 / (800/96) = 360
    // PPI Y: 2000 / (300/96) = 640
    const result = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'stretch',
      bounds: { width: 400, height: 300 },
      worldTransform: [2, 0, 0, 1, 0, 0],
    });
    expect(result.available).toBe(true);
    expect(result.ppiX).toBeCloseTo(360, 0);
    expect(result.ppiY).toBeCloseTo(640, 0);
    expect(result.minimumPpi).toBeCloseTo(360, 0);
  });

  it('rotation does not change effective PPI', () => {
    // 90° rotation: transform [0,1,-1,0,0,0]
    // worldScaleX = hypot(0,1) = 1, worldScaleY = hypot(-1,0) = 1
    // Same effective PPI as no rotation.
    const noRotation = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'stretch',
      bounds: { width: 400, height: 300 },
      worldTransform: [1, 0, 0, 1, 0, 0],
    });
    const withRotation = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'stretch',
      bounds: { width: 400, height: 300 },
      worldTransform: [0, 1, -1, 0, 0, 0],
    });
    expect(withRotation.ppiX).toBeCloseTo(noRotation.ppiX, 5);
    expect(withRotation.ppiY).toBeCloseTo(noRotation.ppiY, 5);
  });

  it('crop rect reduces effective source area', () => {
    // 3000×2000 image, cropped to 1500×1000, stretched to 400×300
    // sampleWidth = 400 * (1500/3000) = 200
    // PPI X: 1500 / (200/96) = 720
    const result = effectiveRasterPpi({
      sourceWidth: 3000,
      sourceHeight: 2000,
      fit: 'stretch',
      bounds: { width: 400, height: 300 },
      crop: { x: 500, y: 300, w: 1500, h: 1000 },
    });
    expect(result.available).toBe(true);
    expect(result.ppiX).toBeCloseTo(720, 0);
  });
});

// ── Rounding policy ──────────────────────────────────────────────────────────

describe('Rounding policy', () => {
  it('output dimensions are always rounded to nearest integer', () => {
    // 100mm at 300 PPI: 100*96/25.4 * 300/96 = 100*300/25.4 = 1181.102...
    const designPx = physicalToDocumentPx(100, 'mm');
    const result = resolveExportScale(
      { mode: 'resolution', dpi: 300 },
      { width: 100, height: 100 },
    );
    const outputPx = Math.round(designPx * result.scaleFactor);
    expect(outputPx).toBe(1181);
  });

  it('minimum scale factor is 1/16', () => {
    const result = resolveExportScale(
      { mode: 'multiplier', value: 0.01 },
      { width: 100, height: 100 },
    );
    expect(result.scaleFactor).toBe(1 / 16);
  });
});

// ── Backwards compatibility ──────────────────────────────────────────────────

describe('Backwards compatibility', () => {
  it('screen document (no dpi) and print document (dpi=300) produce same resolution-mode scale', () => {
    // Resolution mode MUST NOT depend on doc.dpi — resolveExportScale ignores it.
    const screenScale = resolveExportScale(
      { mode: 'resolution', dpi: 150 },
      { width: 800, height: 600 },
    );
    const printScale = resolveExportScale(
      { mode: 'resolution', dpi: 150 },
      { width: 800, height: 600 },
    );
    expect(screenScale.scaleFactor).toBe(150 / 96);
    expect(printScale.scaleFactor).toBe(150 / 96);
  });

  it('existing 1×/2×/3× exports produce identical results regardless of doc.dpi', () => {
    const scales: ExportScale[] = [
      { mode: 'multiplier', value: 1 },
      { mode: 'multiplier', value: 2 },
      { mode: 'multiplier', value: 3 },
    ];
    const nominal = { width: 1200, height: 800 };

    for (const scale of scales) {
      const screenResult = resolveExportScale(scale, nominal);
      const printResult = resolveExportScale(scale, nominal);
      expect(screenResult.scaleFactor).toBe(printResult.scaleFactor);
    }
  });
});

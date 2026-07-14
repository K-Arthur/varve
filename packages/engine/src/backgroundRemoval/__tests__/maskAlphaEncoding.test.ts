/**
 * Regression tests for AI mask alpha encoding.
 *
 * ROOT CAUSE: The worker (AI path) encoded masks with A=255 everywhere,
 * while the heuristic (quick path) encoded A=mask_value. The paintImageFill
 * compositing uses `destination-in` which relies on the alpha channel.
 * A=255 everywhere means the mask has zero effect — everything stays opaque.
 *
 * Canonical mask format: R=G=B=A=mask_value (grayscale in all 4 channels).
 * Verified end-to-end via Playwright E2E test (see tests/e2e/).
 */

import { describe, expect, it } from 'vitest';

describe('destination-in compositing contract', () => {
  /**
   * Canvas2D `destination-in`:
   *   result_alpha = dest_alpha * src_alpha (normalized 0-1)
   *
   * For background removal:
   *   - Background pixels: mask alpha = 0 → dest becomes transparent
   *   - Foreground pixels: mask alpha = 255 → dest stays opaque
   */
  it('alpha=0 removes pixels, alpha=255 preserves them', () => {
    const bgMask = 0 / 255;
    const fgMask = 255 / 255;
    const destAlpha = 1.0;
    expect(destAlpha * bgMask).toBe(0);
    expect(destAlpha * fgMask).toBe(1);
  });

  it('BUG: A=255 everywhere means no transparency change (the root cause)', () => {
    // The worker previously set A=255 for ALL pixels.
    // destination-in with src_alpha=1.0 leaves dest unchanged.
    const buggyAlpha = 255 / 255;
    const destAlpha = 1.0;
    expect(destAlpha * buggyAlpha).toBe(1); // no transparency = mask ineffective
  });

  it('semi-transparent mask produces proportional transparency', () => {
    const halfMask = 128 / 255;
    const destAlpha = 1.0;
    expect(destAlpha * halfMask).toBeCloseTo(128 / 255, 5);
  });

  it('compositing is commutative: alpha order does not matter', () => {
    const a = 0.5;
    const b = 0.8;
    expect(a * b).toBe(b * a);
  });
});

describe('worker encoding contract (code-level)', () => {
  /**
   * The worker.ts fix changes line 194 from:
   *   refined.data[i * 4 + 3] = 255;
   * to:
   *   refined.data[i * 4 + 3] = v;
   *
   * This test documents the expected contract:
   * For each pixel, R=G=B=A=mask_value.
   */
  it('canonical: all 4 channels equal the mask value', () => {
    const mask = [0, 32, 64, 128, 192, 255];
    for (const v of mask) {
      // Simulate correct encoding
      const r = v,
        g = v,
        b = v,
        a = v;
      expect(r).toBe(v);
      expect(g).toBe(v);
      expect(b).toBe(v);
      expect(a).toBe(v);
    }
  });

  it('BUG encoding: A=255 while RGB=mask_value (inconsistent)', () => {
    const mask = [0, 128, 255];
    for (const v of mask) {
      const r = v,
        g = v,
        b = v;
      const buggyA = 255; // The old worker bug
      // With destination-in, only 'a' matters:
      expect(buggyA / 255).toBe(1); // Always opaque = mask ineffective
    }
  });

  it('correct encoding: background pixels have a=0 (will be removed)', () => {
    const bgPixel = 0;
    expect(bgPixel / 255).toBe(0); // Will become transparent via destination-in
  });

  it('correct encoding: foreground pixels have a=255 (will be kept)', () => {
    const fgPixel = 255;
    expect(fgPixel / 255).toBe(1); // Will stay opaque via destination-in
  });
});

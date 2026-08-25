/**
 * Programmatic E2E verification: exercises the effects engine directly
 * in the Playwright test process to verify pixel-level correctness of tritone,
 * gradient map, and halftone rendering.
 */
import { expect, test } from '@playwright/test';
import { applyGradientMapFilter, buildGradientLUT } from '../../../packages/engine/src/gradientMap';
import { applyHalftone } from '../../../packages/engine/src/halftone';
import { applyTritone } from '../../../packages/engine/src/tritone';

const engine = { applyGradientMapFilter, buildGradientLUT, applyHalftone, applyTritone };

test.describe('Effects engine pixel-level verification', () => {
  test('tritone: pixel mapping correctness', async ({ page }) => {
    await page.goto('/');
    // Wait for the app to load
    await page.waitForTimeout(2000);

    const result = (() => {
      // Create a test image: 4x1 gradient from black to white
      const width = 4;
      const height = 1;
      const data = new Uint8ClampedArray([
        0,
        0,
        0,
        255, // black
        85,
        85,
        85,
        255, // dark gray
        170,
        170,
        170,
        255, // light gray
        255,
        255,
        255,
        255, // white
      ]);
      const imageData = { data, width, height, colorSpace: 'srgb' as const } as ImageData;

      // Apply tritone with known colors
      const tritoneParams = {
        shadowColor: [0, 0, 255, 255] as const, // blue
        midtoneColor: [128, 128, 128, 255] as const, // gray
        highlightColor: [255, 0, 0, 255] as const, // red
        shadowPoint: 0.33,
        highlightPoint: 0.67,
        intensity: 1,
        preserveLuminosity: false,
      };

      engine.applyTritone(imageData, tritoneParams);

      return {
        pixel0: Array.from(data.slice(0, 4)), // black → should be blue-ish
        pixel1: Array.from(data.slice(4, 8)), // dark gray → transition
        pixel2: Array.from(data.slice(8, 12)), // light gray → transition
        pixel3: Array.from(data.slice(12, 16)), // white → should be red-ish
        allValid: Array.from(data).every((v) => v >= 0 && v <= 255),
      };
    })();

    console.log('Tritone pixel output:', JSON.stringify(result, null, 2));

    // Black pixel should map toward shadow color (blue)
    expect(result.pixel0[2]).toBeGreaterThan(200); // B channel high
    expect(result.pixel0[0]).toBeLessThan(50); // R channel low

    // White pixel should map toward highlight color (red)
    expect(result.pixel3[0]).toBeGreaterThan(200); // R channel high
    expect(result.pixel3[2]).toBeLessThan(50); // B channel low

    // All values should be valid bytes
    expect(result.allValid).toBe(true);
  });

  test('gradient map: LUT and pixel mapping', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const result = (() => {
      // Create a test image: 3x1 gradient
      const width = 3;
      const height = 1;
      const data = new Uint8ClampedArray([
        0,
        0,
        0,
        255, // black
        128,
        128,
        128,
        255, // gray
        255,
        255,
        255,
        255, // white
      ]);
      const imageData = { data, width, height, colorSpace: 'srgb' as const } as ImageData;

      // Test LUT building
      const stops = [
        { position: 0, color: [255, 0, 0, 255] as const }, // red at dark
        { position: 0.5, color: [0, 255, 0, 255] as const }, // green at mid
        { position: 1, color: [0, 0, 255, 255] as const }, // blue at bright
      ];

      const lut = engine.buildGradientLUT(stops);

      // Apply gradient map
      engine.applyGradientMapFilter(imageData, {
        stops,
        dither: false,
        preserveLuminosity: false,
      });

      return {
        // Check LUT values
        lutBlackR: lut.r[0],
        lutBlackG: lut.g[0],
        lutBlackB: lut.b[0],
        lutMidR: lut.r[128],
        lutMidG: lut.g[128],
        lutMidB: lut.b[128],
        lutWhiteR: lut.r[255],
        lutWhiteG: lut.g[255],
        lutWhiteB: lut.b[255],

        // Check applied pixels
        pixel0: Array.from(data.slice(0, 4)), // black → red
        pixel1: Array.from(data.slice(4, 8)), // gray → green
        pixel2: Array.from(data.slice(8, 12)), // white → blue

        allValid: Array.from(data).every((v) => v >= 0 && v <= 255),
      };
    })();

    console.log('Gradient map output:', JSON.stringify(result, null, 2));

    // LUT: black maps to red
    expect(result.lutBlackR).toBeGreaterThan(250);
    expect(result.lutBlackG).toBeLessThan(5);
    expect(result.lutBlackB).toBeLessThan(5);

    // LUT: mid maps to green
    expect(result.lutMidG).toBeGreaterThan(200);

    // LUT: white maps to blue
    expect(result.lutWhiteB).toBeGreaterThan(250);

    // Applied: black pixel → red
    expect(result.pixel0[0]).toBeGreaterThan(250);

    // Applied: gray pixel → green-ish
    expect(result.pixel1[1]).toBeGreaterThan(150);

    // Applied: white pixel → blue
    expect(result.pixel2[2]).toBeGreaterThan(250);

    expect(result.allValid).toBe(true);
  });

  test('halftone: AM screening produces binary-ish output', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const result = (() => {
      // Create a test image: 8x8 gradient
      const size = 8;
      const data = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;
          const gray = Math.round((x / (size - 1)) * 255);
          data[idx] = gray;
          data[idx + 1] = gray;
          data[idx + 2] = gray;
          data[idx + 3] = 255;
        }
      }
      const imageData = {
        data,
        width: size,
        height: size,
        colorSpace: 'srgb' as const,
      } as ImageData;

      // Apply AM halftone
      engine.applyHalftone(imageData, {
        pattern: 'dot',
        frequency: 45,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
        threshold: 128,
        intensity: 1,
        softness: 0,
      });

      // Count unique values in output
      const uniqueValues = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        uniqueValues.add(data[i]!);
      }

      // Check that output is not all the same value (halftone produced variation)
      return {
        uniqueGrays: uniqueValues.size,
        minGray: Math.min(...uniqueValues),
        maxGray: Math.max(...uniqueValues),
        // Halftone should produce at least 2 distinct gray levels
        hasBinaryOutput: uniqueValues.size >= 2,
        allValid: Array.from(data).every((v) => v >= 0 && v <= 255),
        // Alpha should be preserved
        alphaPreserved: Array.from({ length: size * size }, (_, i) => data[i * 4 + 3]!).every(
          (a) => a === 255,
        ),
      };
    })();

    console.log('Halftone output:', JSON.stringify(result, null, 2));

    expect(result.hasBinaryOutput).toBe(true);
    expect(result.allValid).toBe(true);
    expect(result.alphaPreserved).toBe(true);
  });

  test('gradient map: dither produces smoother output', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const result = (() => {
      // Create a smooth gradient: 32x1 pixels
      const width = 32;
      const height = 1;
      const data = new Uint8ClampedArray(width * 4);
      for (let x = 0; x < width; x++) {
        const gray = Math.round((x / (width - 1)) * 255);
        data[x * 4] = gray;
        data[x * 4 + 1] = gray;
        data[x * 4 + 2] = gray;
        data[x * 4 + 3] = 255;
      }

      const stops = [
        { position: 0, color: [0, 0, 0, 255] as const },
        { position: 1, color: [255, 255, 255, 255] as const },
      ];

      // Without dither
      const noDitherData = new Uint8ClampedArray(data);
      const noDitherImg = {
        data: noDitherData,
        width,
        height,
        colorSpace: 'srgb' as const,
      } as ImageData;
      engine.applyGradientMapFilter(noDitherImg, {
        stops,
        dither: false,
        preserveLuminosity: false,
      });

      // With dither
      const withDitherData = new Uint8ClampedArray(data);
      const withDitherImg = {
        data: withDitherData,
        width,
        height,
        colorSpace: 'srgb' as const,
      } as ImageData;
      engine.applyGradientMapFilter(withDitherImg, {
        stops,
        dither: true,
        preserveLuminosity: false,
      });

      // Count transitions (banding indicator)
      let noDitherTransitions = 0;
      let withDitherTransitions = 0;
      for (let x = 1; x < width; x++) {
        if (noDitherData[x * 4] !== noDitherData[(x - 1) * 4]) noDitherTransitions++;
        if (withDitherData[x * 4] !== withDitherData[(x - 1) * 4]) withDitherTransitions++;
      }

      return {
        noDitherTransitions,
        withDitherTransitions,
        // Dithered output should have more transitions (less banding)
        ditherSmoother: withDitherTransitions >= noDitherTransitions,
        allValid: Array.from(withDitherData).every((v) => v >= 0 && v <= 255),
      };
    })();

    console.log('Dither comparison:', JSON.stringify(result, null, 2));

    expect(result.allValid).toBe(true);
    // With 8x8 dither, we should see more transitions (less banding)
    expect(result.ditherSmoother).toBe(true);
  });

  test('tritone: alpha preservation across transparency levels', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const result = (() => {
      // Create test image with various alpha levels
      const data = new Uint8ClampedArray([
        128,
        128,
        128,
        255, // fully opaque
        128,
        128,
        128,
        128, // 50% transparent
        128,
        128,
        128,
        64, // 25% transparent
        128,
        128,
        128,
        0, // fully transparent
      ]);
      const imageData = { data, width: 4, height: 1, colorSpace: 'srgb' as const } as ImageData;

      engine.applyTritone(imageData, {
        shadowColor: [0, 0, 255, 255],
        midtoneColor: [128, 128, 128, 255],
        highlightColor: [255, 0, 0, 255],
        shadowPoint: 0.33,
        highlightPoint: 0.67,
        intensity: 1,
        preserveLuminosity: false,
      });

      return {
        alpha0: data[3], // should be 255 (preserved)
        alpha1: data[7], // should be 128 (preserved)
        alpha2: data[11], // should be 64 (preserved)
        alpha3: data[15], // should be 0 (preserved, skipped)
        // RGB should be unchanged for transparent pixel
        rgb3: [data[12], data[13], data[14]],
      };
    })();

    console.log('Alpha preservation:', JSON.stringify(result, null, 2));

    expect(result.alpha0).toBe(255);
    expect(result.alpha1).toBe(128);
    expect(result.alpha2).toBe(64);
    expect(result.alpha3).toBe(0);
    // Fully transparent pixel should not have its RGB changed
    expect(result.rgb3).toEqual([128, 128, 128]);
  });

  test('halftone: CMYK channel screening', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const result = (() => {
      // Create a 4x4 color test image
      const data = new Uint8ClampedArray([
        255,
        0,
        0,
        255, // red
        0,
        255,
        0,
        255, // green
        0,
        0,
        255,
        255, // blue
        255,
        255,
        0,
        255, // yellow
        255,
        0,
        255,
        255, // magenta
        0,
        255,
        255,
        255, // cyan
        128,
        128,
        128,
        255, // gray
        0,
        0,
        0,
        255, // black
        255,
        128,
        0,
        255, // orange
        128,
        0,
        128,
        255, // purple
        0,
        128,
        0,
        255, // dark green
        128,
        128,
        0,
        255, // olive
        64,
        64,
        64,
        255, // dark gray
        192,
        192,
        192,
        255, // light gray
        255,
        192,
        128,
        255, // peach
        128,
        192,
        255,
        255, // light blue
      ]);
      const imageData = { data, width: 4, height: 4, colorSpace: 'srgb' as const } as ImageData;

      engine.applyHalftone(imageData, {
        pattern: 'dot',
        frequency: 45,
        angle: 45,
        dotShape: 'round',
        channel: 'cmyk',
        method: 'am',
        threshold: 128,
        intensity: 1,
        softness: 0,
      });

      // All output values should be valid RGB bytes
      const allValid = Array.from(data).every((v) => v >= 0 && v <= 255);
      // Alpha should be preserved
      const alphaCorrect = [data[3], data[7], data[11], data[15]].every((a) => a === 255);

      // Output should differ from input (halftone applied)
      const inputR = [255, 0, 0, 255, 255, 0, 128, 0, 255, 128, 0, 128, 64, 192, 255, 128];
      const outputR = Array.from({ length: 16 }, (_, i) => data[i * 4]);
      const differs = inputR.some((v, i) => v !== outputR[i]);

      return { allValid, alphaCorrect, differs };
    })();

    console.log('CMYK halftone:', JSON.stringify(result, null, 2));

    expect(result.allValid).toBe(true);
    expect(result.alphaCorrect).toBe(true);
    expect(result.differs).toBe(true);
  });
});

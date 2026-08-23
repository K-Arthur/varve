import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { injectPngPhys, ppiToPixelsPerMeter, readPngPhys } from '../pngDensity';

/**
 * Load a real PNG fixture from the project. The file is known to be a valid
 * PNG without a pHYs chunk (APNG test fixtures typically don't have one).
 */
function loadFixturePng(): Uint8Array {
  const fixturePath = join(
    import.meta.dirname ?? __dirname,
    '../../../../engine/src/media/__fixtures__/apng-single.png',
  );
  return new Uint8Array(readFileSync(fixturePath));
}

describe('PNG pHYs metadata', () => {
  it('injects a pHYs chunk and reads it back', () => {
    const png = loadFixturePng();
    // Verify no pHYs chunk exists in the original.
    expect(readPngPhys(png)).toBeNull();

    const ppm = ppiToPixelsPerMeter(300);
    const injected = injectPngPhys(png, ppm, ppm, 1);

    // Size increased by 21 bytes (4 len + 4 type + 9 data + 4 CRC).
    expect(injected.length).toBe(png.length + 21);

    const phys = readPngPhys(injected);
    expect(phys).not.toBeNull();
    expect(phys!.ppuX).toBe(ppm);
    expect(phys!.ppuY).toBe(ppm);
    expect(phys!.unit).toBe(1);
  });

  it('replaces an existing pHYs chunk in-place', () => {
    const png = loadFixturePng();
    const ppm72 = ppiToPixelsPerMeter(72);
    const step1 = injectPngPhys(png, ppm72, ppm72, 1);
    const phys1 = readPngPhys(step1);
    expect(phys1).not.toBeNull();
    expect(phys1!.ppuX).toBe(ppm72);

    const ppm300 = ppiToPixelsPerMeter(300);
    const step2 = injectPngPhys(step1, ppm300, ppm300, 1);
    // Size unchanged (replacement, not insertion).
    expect(step2.length).toBe(step1.length);

    const phys2 = readPngPhys(step2);
    expect(phys2).not.toBeNull();
    expect(phys2!.ppuX).toBe(ppm300);
    expect(phys2!.ppuY).toBe(ppm300);
  });

  it('returns original bytes for invalid PNG', () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(injectPngPhys(garbage, 100, 100)).toBe(garbage);
  });

  it('returns null when no pHYs chunk exists', () => {
    const png = loadFixturePng();
    expect(readPngPhys(png)).toBeNull();
  });

  it('ppiToPixelsPerMeter is accurate', () => {
    // 72 PPI → 2834.65 ppm → rounded to 2835
    expect(ppiToPixelsPerMeter(72)).toBe(2835);
    // 300 PPI → 11811.02 ppm → rounded to 11811
    expect(ppiToPixelsPerMeter(300)).toBe(11811);
    // 96 PPI → 3779.53 ppm → rounded to 3780
    expect(ppiToPixelsPerMeter(96)).toBe(3780);
  });

  it('readPngPhys parses a hand-built pHYs chunk', () => {
    // Manually build a minimal PNG with pHYs: sig + IHDR + pHYs + IDAT + IEND.
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR: 1×1 RGBA 8-bit (25 bytes).
    const ihdr = new Uint8Array([
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 1, 0, 0, 0, 1,
      8, 6, 0, 0, 0,
      0x1f, 0x15, 0xc4, 0x89, // placeholder CRC (won't matter for pHYs test)
    ]);
    // pHYs chunk: len=9, type=pHYs, ppuX=11811, ppuY=2835, unit=1.
    const ppuX = 11811;
    const ppuY = 2835;
    const physBytes = new Uint8Array([
      0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73,
      (ppuX >>> 24) & 0xff, (ppuX >>> 16) & 0xff, (ppuX >>> 8) & 0xff, ppuX & 0xff,
      (ppuY >>> 24) & 0xff, (ppuY >>> 16) & 0xff, (ppuY >>> 8) & 0xff, ppuY & 0xff,
      1,
      0x00, 0x00, 0x00, 0x00, // placeholder CRC
    ]);
    // IDAT + IEND minimal.
    const idatIend = new Uint8Array([
      0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82, // IEND with correct CRC
    ]);

    const png = new Uint8Array(sig.length + ihdr.length + physBytes.length + idatIend.length);
    let off = 0;
    png.set(sig, off); off += sig.length;
    png.set(ihdr, off); off += ihdr.length;
    png.set(physBytes, off); off += physBytes.length;
    png.set(idatIend, off);

    const phys = readPngPhys(png);
    expect(phys).not.toBeNull();
    expect(phys!.ppuX).toBe(11811);
    expect(phys!.ppuY).toBe(2835);
    expect(phys!.unit).toBe(1);
  });
});

/**
 * Tests for the ICO and ICNS icon container encoders: structural validity,
 * determinism, deduplication, and bounds safety.
 */
import { describe, expect, it } from 'vitest';
import { buildIcns, ICNS_REPRESENTATIONS, validateIcns } from './icns';
import { buildIco, ICO_MAX_ENTRIES, ICO_SUPPORTED_SIZES, validateIco } from './ico';

/** Minimal but structurally valid PNG header (8-byte sig + IHDR-ish zeros). */
function fakePng(size: number): Uint8Array {
  const bytes = new Uint8Array(8 + 4);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, size); // placeholder for IHDR length field
  return bytes;
}

describe('ICO encoder', () => {
  it('builds a valid multi-size ICO', () => {
    const result = buildIco([
      { size: 32, png: fakePng(32) },
      { size: 16, png: fakePng(16) },
      { size: 256, png: fakePng(256) },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.entries).toEqual([16, 32, 256]);
    const validation = validateIco(result.bytes);
    expect(validation.ok).toBe(true);
    expect(validation.warnings).toEqual([]);
  });

  it('encodes 256px as 0x00 width/height', () => {
    const result = buildIco([{ size: 256, png: fakePng(256) }]);
    const view = new DataView(
      result.bytes.buffer,
      result.bytes.byteOffset,
      result.bytes.byteLength,
    );
    expect(result.bytes[6]).toBe(0);
    expect(result.bytes[7]).toBe(0);
    expect(view.getUint16(10, true)).toBe(1); // planes
  });

  it('deduplicates sizes deterministically', () => {
    const first = buildIco([
      { size: 16, png: fakePng(1) },
      { size: 32, png: fakePng(2) },
      { size: 16, png: fakePng(3) },
    ]);
    const second = buildIco([
      { size: 32, png: fakePng(2) },
      { size: 16, png: fakePng(1) },
    ]);
    expect(first.entries).toEqual([16, 32]);
    expect(second.entries).toEqual([16, 32]);
    // deterministic: same output for same input set
    expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
    expect(first.warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('rejects non-PNG entries with a warning', () => {
    const result = buildIco([{ size: 16, png: new Uint8Array([1, 2, 3]) }]);
    expect(result.entries).toEqual([]);
    expect(result.bytes.length).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('clamps sizes to 1-256', () => {
    const result = buildIco([{ size: 999, png: fakePng(1) }]);
    expect(result.entries).toEqual([256]);
    expect(validateIco(result.bytes).ok).toBe(true);
  });

  it('caps entry count', () => {
    const entries = Array.from({ length: ICO_MAX_ENTRIES + 4 }, (_, i) => ({
      size: 16 + i,
      png: fakePng(i),
    }));
    const result = buildIco(entries);
    expect(result.entries.length).toBe(ICO_MAX_ENTRIES);
    expect(result.warnings.some((w) => w.includes('Truncating'))).toBe(true);
  });

  it('reports out-of-bounds offsets as invalid', () => {
    const result = buildIco([{ size: 16, png: fakePng(16) }]);
    const bytes = result.bytes.slice(0, result.bytes.length - 3);
    const validation = validateIco(bytes);
    expect(validation.ok).toBe(false);
  });

  it('declares standard sizes in the supported set', () => {
    expect(ICO_SUPPORTED_SIZES).toContain(16);
    expect(ICO_SUPPORTED_SIZES).toContain(256);
  });
});

describe('ICNS encoder', () => {
  it('builds a valid container with canonical ordering', () => {
    const result = buildIcns([
      { type: 'ic08', png: fakePng(1) },
      { type: 'icp4', png: fakePng(2) },
      { type: 'ic10', png: fakePng(3) },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.types).toEqual(['icp4', 'ic08', 'ic10']);
    const validation = validateIcns(result.bytes);
    expect(validation.ok).toBe(true);
    expect(validation.representations).toEqual(['icp4', 'ic08', 'ic10']);
  });

  it('is deterministic for identical inputs', () => {
    const a = buildIcns([
      { type: 'ic08', png: fakePng(1) },
      { type: 'icp4', png: fakePng(2) },
    ]);
    const b = buildIcns([
      { type: 'ic08', png: fakePng(1) },
      { type: 'icp4', png: fakePng(2) },
    ]);
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });

  it('drops duplicate chunk types', () => {
    const result = buildIcns([
      { type: 'ic08', png: fakePng(1) },
      { type: 'ic08', png: fakePng(2) },
    ]);
    expect(result.types).toEqual(['ic08']);
    expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('rejects non-PNG chunks', () => {
    const result = buildIcns([{ type: 'ic08', png: new Uint8Array([0, 0, 0]) }]);
    expect(result.bytes.length).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('flags corrupted containers', () => {
    const result = buildIcns([{ type: 'ic08', png: fakePng(1) }]);
    const truncated = result.bytes.slice(0, result.bytes.length - 2);
    const validation = validateIcns(truncated);
    expect(validation.ok).toBe(false);
    const badSig = result.bytes.slice();
    badSig[0] = 0;
    expect(validateIcns(badSig).ok).toBe(false);
  });

  it('covers the retina representation set with alpha', () => {
    const reps = ICNS_REPRESENTATIONS;
    expect(reps.some((r) => r.type === 'ic11')).toBe(true); // 16@2x
    expect(reps.some((r) => r.type === 'ic15')).toBe(true); // 512@2x
    expect(reps.some((r) => r.type === 'ic10')).toBe(true); // 1024
    expect(reps.length).toBe(12);
  });
});

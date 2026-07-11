import { describe, expect, it } from 'vitest';
import {
  exportAcoPalette,
  exportGplPalette,
  type GplColorEntry,
  parseAcoPalette,
  parseAsePalette,
  parseGplPalette,
} from './paletteFormats';

/** Build an ASE binary buffer from high-level descriptor. */
function buildAseBuffer(
  colorCount: number,
  blocks: { type: number; data: Uint8Array }[],
): ArrayBuffer {
  const header = new Uint8Array(10);
  header[0] = 0x41; // A
  header[1] = 0x53; // S
  header[2] = 0x45; // E
  header[3] = 0x46; // F
  header[4] = 0x00; // version hi
  header[5] = 0x01; // version lo
  header[6] = 0x00; // count hi
  header[7] = 0x00; // count hi
  header[8] = 0x00; // count hi
  header[9] = colorCount; // count lo

  const parts: Uint8Array[] = [header];
  for (const block of blocks) {
    const typeBytes = new Uint8Array(2);
    typeBytes[0] = (block.type >> 8) & 0xff;
    typeBytes[1] = block.type & 0xff;
    const totalLen = 6 + block.data.length;
    const lenBytes = new Uint8Array(4);
    lenBytes[0] = (totalLen >> 24) & 0xff;
    lenBytes[1] = (totalLen >> 16) & 0xff;
    lenBytes[2] = (totalLen >> 8) & 0xff;
    lenBytes[3] = totalLen & 0xff;
    parts.push(typeBytes, lenBytes, block.data);
  }

  const total = parts.reduce((s, p) => s + p.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.length;
  }
  return merged.buffer;
}

/** Encode a Pascal string (u16 BE length + UTF-16 BE chars). */
function pascalString(s: string): Uint8Array {
  const chars: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    chars.push((code >> 8) & 0xff, code & 0xff);
  }
  const buf = new Uint8Array(2 + chars.length);
  buf[0] = (s.length >> 8) & 0xff;
  buf[1] = s.length & 0xff;
  buf.set(chars, 2);
  return buf;
}

/** Build an ASE RGB color entry block. r/g/b are 0-1 floats. */
function aseRgbBlock(name: string, r: number, g: number, b: number): Uint8Array {
  const nameBytes = pascalString(name);
  const modeBytes = new Uint8Array([0x52, 0x47, 0x42, 0x20]); // "RGB "
  const values = new Uint8Array(16);
  const setF32 = (off: number, v: number) => {
    const dv = new DataView(values.buffer);
    dv.setFloat32(off, v, false);
  };
  setF32(0, r);
  setF32(4, g);
  setF32(8, b);
  setF32(12, 0); // alpha/type
  const endMarker = new Uint8Array([0x00, 0x00]);
  const combined = new Uint8Array(
    nameBytes.length + modeBytes.length + values.length + endMarker.length,
  );
  combined.set(nameBytes, 0);
  combined.set(modeBytes, nameBytes.length);
  combined.set(values, nameBytes.length + 4);
  combined.set(endMarker, nameBytes.length + 4 + 16);
  return combined;
}

describe('parseGplPalette', () => {
  it('parses standard GIMP palette format', () => {
    const gpl = `GIMP Palette
Name: Test Palette
Columns: 4
#
255\t0\t0\tRed
0\t255\t0\tGreen
0\t0\t255\tBlue
`;
    const result = parseGplPalette(gpl);
    expect(result.name).toBe('Test Palette');
    expect(result.colors).toHaveLength(3);
    expect(result.colors[0]).toMatchObject({ r: 255, g: 0, b: 0, name: 'Red' });
    expect(result.colors[1]).toMatchObject({ r: 0, g: 255, b: 0, name: 'Green' });
    expect(result.colors[2]).toMatchObject({ r: 0, g: 0, b: 255, name: 'Blue' });
  });

  it('handles palette without name', () => {
    const gpl = `GIMP Palette
#
128\t128\t128\tGray
`;
    const result = parseGplPalette(gpl);
    expect(result.colors).toHaveLength(1);
    expect(result.colors[0]?.r).toBe(128);
  });

  it('throws on invalid header', () => {
    expect(() => parseGplPalette('Not a palette')).toThrow(/GIMP Palette/);
  });
});

describe('exportGplPalette', () => {
  it('round-trips through parse', () => {
    const colors: GplColorEntry[] = [
      { r: 255, g: 128, b: 0, name: 'Orange' },
      { r: 0, g: 0, b: 0, name: 'Black' },
    ];
    const exported = exportGplPalette('Round Trip', colors);
    const parsed = parseGplPalette(exported);
    expect(parsed.name).toBe('Round Trip');
    expect(parsed.colors).toHaveLength(2);
    expect(parsed.colors[0]).toMatchObject({ r: 255, g: 128, b: 0, name: 'Orange' });
  });
});

describe('parseAsePalette', () => {
  it('parses a minimal ASE buffer with 2 RGB colors', () => {
    const redBlock = aseRgbBlock('Red', 1.0, 0.0, 0.0);
    const blueBlock = aseRgbBlock('Blue', 0.0, 0.0, 1.0);
    const buf = buildAseBuffer(2, [
      { type: 2, data: redBlock },
      { type: 2, data: blueBlock },
    ]);
    const result = parseAsePalette(buf);
    expect(result.colors).toHaveLength(2);
    expect(result.groups).toHaveLength(0);
    expect(result.colors[0]).toMatchObject({ name: 'Red', r: 255, g: 0, b: 0 });
    expect(result.colors[1]).toMatchObject({ name: 'Blue', r: 0, g: 0, b: 255 });
  });

  it('parses ASE with a named group containing colors', () => {
    const groupName = pascalString('Warm Tones');
    const redBlock = aseRgbBlock('Red', 1.0, 0.0, 0.0);
    const orangeBlock = aseRgbBlock('Orange', 1.0, 0.5, 0.0);
    const buf = buildAseBuffer(2, [
      { type: 1, data: groupName },
      { type: 2, data: redBlock },
      { type: 2, data: orangeBlock },
    ]);
    const result = parseAsePalette(buf);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.name).toBe('Warm Tones');
    expect(result.groups[0]?.colors).toHaveLength(2);
    expect(result.groups[0]?.colors[0]).toMatchObject({ name: 'Red', r: 255, g: 0, b: 0 });
    expect(result.groups[0]?.colors[1]).toMatchObject({ name: 'Orange', r: 255, g: 128, b: 0 });
    expect(result.colors).toHaveLength(0);
  });

  it('throws on empty/truncated buffer', () => {
    expect(() => parseAsePalette(new ArrayBuffer(0))).toThrow('buffer too small');
    expect(() => parseAsePalette(new ArrayBuffer(4))).toThrow('buffer too small');
  });

  it('throws on missing ASEF magic', () => {
    // Buffer >= 12 bytes with non-ASEF magic at positions 0-3
    const buf = new Uint8Array([0x41, 0x42, 0x43, 0x44, 0, 1, 0, 0, 0, 1, 0, 1]).buffer;
    expect(() => parseAsePalette(buf)).toThrow('ASEF');
  });

  it('handles colors at value boundaries', () => {
    const blackBlock = aseRgbBlock('Black', 0.0, 0.0, 0.0);
    const whiteBlock = aseRgbBlock('White', 1.0, 1.0, 1.0);
    const buf = buildAseBuffer(2, [
      { type: 2, data: blackBlock },
      { type: 2, data: whiteBlock },
    ]);
    const result = parseAsePalette(buf);
    expect(result.colors[0]).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(result.colors[1]).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  it('handles truncated block data gracefully', () => {
    // Write a valid header but then a block with bogus length past the buffer
    const header = new Uint8Array(10);
    header[0] = 0x41;
    header[1] = 0x53;
    header[2] = 0x45;
    header[3] = 0x46;
    header[4] = 0x00;
    header[5] = 0x01;
    header[9] = 1;
    // block type=2 with claimed length 999 (way past buffer)
    const blockHead = new Uint8Array(6);
    blockHead[0] = 0;
    blockHead[1] = 2; // type=2
    blockHead[2] = 0;
    blockHead[3] = 0;
    blockHead[4] = 0x03;
    blockHead[5] = 0xe7; // len=999
    const merged = new Uint8Array(header.length + blockHead.length);
    merged.set(header, 0);
    merged.set(blockHead, 10);
    const result = parseAsePalette(merged.buffer);
    expect(result.colors).toHaveLength(0);
  });
});

describe('parseAcoPalette', () => {
  it('parses ACO version 1 RGB entries', () => {
    const colors = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
    ];
    const buf = exportAcoPalette(colors);
    const parsed = parseAcoPalette(buf);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.r).toBeCloseTo(255, 0);
    expect(parsed[1]?.g).toBeCloseTo(255, 0);
  });
});

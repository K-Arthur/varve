import { describe, expect, it } from 'vitest';
import { decodeDng, isDngSignature } from './decoder';
import { BASELINE_DNG_DECODER_ID, defaultRawRecipe, developRaw } from './develop';
import { RawDecodeError, type RawMosaic } from './types';

interface DngFixtureOptions {
  width?: number;
  height?: number;
  bits?: 8 | 10 | 12 | 14 | 16;
  compression?: number;
  values?: number[];
}

/** Small genuine TIFF/DNG-container fixture; it contains sensor samples, not a JPEG preview. */
function makeDng(options: DngFixtureOptions = {}): Uint8Array {
  const width = options.width ?? 4;
  const height = options.height ?? 4;
  const bits = options.bits ?? 16;
  const compression = options.compression ?? 1;
  const maxValue = 2 ** bits - 1;
  const values =
    options.values ?? Array.from({ length: width * height }, (_, index) => 100 + (index % 8) * 400);
  const rowBytes = Math.ceil((width * bits) / 8);
  const stripBytes = rowBytes * height;
  const bytes = new Uint8Array(8192);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  let cursor = 8;
  const entries: Array<{ tag: number; type: number; count: number; data: Uint8Array }> = [];
  const ascii = (value: string) => new TextEncoder().encode(`${value}\0`);
  const u16 = (items: number[]) => {
    const data = new Uint8Array(items.length * 2);
    const dataView = new DataView(data.buffer);
    items.forEach((item, index) => {
      dataView.setUint16(index * 2, item, true);
    });
    return data;
  };
  const u32 = (items: number[]) => {
    const data = new Uint8Array(items.length * 4);
    const dataView = new DataView(data.buffer);
    items.forEach((item, index) => {
      dataView.setUint32(index * 4, item, true);
    });
    return data;
  };
  const rational = (items: Array<[number, number]>) => {
    const data = new Uint8Array(items.length * 8);
    const dataView = new DataView(data.buffer);
    items.forEach(([numerator, denominator], index) => {
      dataView.setUint32(index * 8, numerator, true);
      dataView.setUint32(index * 8 + 4, denominator, true);
    });
    return data;
  };
  const add = (tag: number, type: number, count: number, data: Uint8Array) =>
    entries.push({ tag, type, count, data });
  add(256, 4, 1, u32([width]));
  add(257, 4, 1, u32([height]));
  add(258, 3, 1, u16([bits]));
  add(259, 3, 1, u16([compression]));
  add(262, 3, 1, u16([32803]));
  add(277, 3, 1, u16([1]));
  add(278, 4, 1, u32([height]));
  add(284, 3, 1, u16([1]));
  add(266, 3, 1, u16([1]));
  add(33421, 3, 2, u16([2, 2]));
  add(33422, 1, 4, new Uint8Array([0, 1, 1, 2]));
  add(50706, 1, 4, new Uint8Array([1, 4, 0, 0]));
  const make = ascii('Varve');
  const model = ascii('Model-X');
  const uniqueModel = ascii('VarveCam');
  add(50708, 2, uniqueModel.length, uniqueModel);
  add(271, 2, make.length, make);
  add(272, 2, model.length, model);
  add(50714, 3, 4, u16([100, 100, 100, 100]));
  add(50717, 3, 1, u16([maxValue]));
  add(
    50728,
    5,
    3,
    rational([
      [1, 1],
      [1, 1],
      [1, 1],
    ]),
  );
  add(273, 4, 1, u32([0]));
  add(279, 4, 1, u32([stripBytes]));
  const entryOffset = cursor;
  view.setUint16(entryOffset, entries.length, true);
  cursor += 2 + entries.length * 12 + 4;
  const patchStripOffset = entries.findIndex((entry) => entry.tag === 273);
  for (const [index, entry] of entries.entries()) {
    const at = entryOffset + 2 + index * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.count, true);
    if (entry.data.length <= 4) bytes.set(entry.data, at + 8);
    else {
      view.setUint32(at + 8, cursor, true);
      bytes.set(entry.data, cursor);
      cursor += entry.data.length;
    }
  }
  view.setUint32(entryOffset + 2 + entries.length * 12, 0, true);
  const stripOffset = cursor;
  view.setUint32(entryOffset + 2 + patchStripOffset * 12 + 8, stripOffset, true);
  if (bits === 16) {
    values.forEach((value, index) => {
      view.setUint16(stripOffset + index * 2, value, true);
    });
  } else {
    for (let index = 0; index < values.length; index++) {
      const value = values[index]!;
      const row = Math.floor(index / width);
      const column = index % width;
      for (let bit = 0; bit < bits; bit++) {
        const sourceBit = (value >>> (bits - bit - 1)) & 1;
        const absolute = row * rowBytes * 8 + column * bits + bit;
        const byteOffset = stripOffset + Math.floor(absolute / 8);
        bytes[byteOffset] = bytes[byteOffset]! | (sourceBit << (7 - (absolute % 8)));
      }
    }
  }
  return bytes.slice(0, stripOffset + stripBytes);
}

describe('bounded DNG sensor decoder', () => {
  it('reads a CFA raw strip and ignores no thumbnail because sensor pixels are authoritative', () => {
    const input = makeDng();
    expect(isDngSignature(input)).toBe(true);
    const mosaic = decodeDng(input);
    expect(mosaic.sourceFormat).toBe('dng-bayer-uncompressed');
    expect(mosaic.kind).toBe('bayer');
    expect(mosaic.cfaPattern).toEqual([0, 1, 1, 2]);
    expect(mosaic.camera.make).toBe('Varve');
    expect(mosaic.camera.model).toBe('Model-X');
    expect(mosaic.pixels[0]).toBe(100);
    expect(mosaic.pixels[1]).toBe(500);
    expect(mosaic.warnings).toContain(
      'no DNG camera color matrix; camera-matrix profile is unavailable',
    );
  });

  it('unpacks MSB-first 10-bit sensor samples without promoting a preview', () => {
    const input = makeDng({ width: 3, height: 2, bits: 10, values: [1, 2, 3, 511, 700, 1023] });
    expect(Array.from(decodeDng(input).pixels)).toEqual([1, 2, 3, 511, 700, 1023]);
  });

  it('develops scene-linear output with reversible white balance and exposure controls', () => {
    const mosaic = decodeDng(
      makeDng({
        values: [
          100, 500, 900, 1300, 1700, 2100, 2500, 2900, 3300, 3700, 4100, 4500, 4900, 5300, 5700,
          6100,
        ],
      }),
    );
    const recipe = defaultRawRecipe(mosaic);
    expect(recipe.decoderId).toBe(BASELINE_DNG_DECODER_ID);
    const base = developRaw(mosaic, recipe);
    const brighter = developRaw(mosaic, { ...recipe, exposureStops: 1 });
    expect(base.raster.contract.reference).toBe('scene-linear');
    expect(base.raster.contract.provenance).toBe('raw-development');
    expect(brighter.raster.pixels[0]).toBeCloseTo(base.raster.pixels[0]! * 2, 3);
    expect(base.diagnostics.whiteBalanceSource).toBe('as-shot');
  });

  it('rejects compressed input before allocating a raw image buffer', () => {
    expect(() => decodeDng(makeDng({ compression: 7 }))).toThrow(RawDecodeError);
  });

  it('chooses the as-shot camera matrix and adapts DNG D50 data to the sRGB D65 boundary', () => {
    const mosaic: RawMosaic = {
      width: 4,
      height: 4,
      pixels: new Uint16Array(16).fill(20_000),
      bitDepth: 16,
      kind: 'bayer',
      cfaPattern: [0, 1, 1, 2],
      blackLevel: [0],
      whiteLevel: [65_535],
      activeArea: { top: 0, left: 0, bottom: 4, right: 4 },
      asShotNeutral: [0.95047, 1, 1.08883],
      colorMatrix1: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      colorMatrix2: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      calibrationIlluminant1: 17,
      calibrationIlluminant2: 21,
      camera: { orientation: 1 },
      sourceFormat: 'dng-bayer-uncompressed',
      warnings: [],
    };
    const result = developRaw(mosaic, defaultRawRecipe(mosaic));
    expect(result.diagnostics.cameraMatrix).toBe('color-matrix-2');
    expect(result.raster.contract.reference).toBe('scene-linear');
    expect(Array.from(result.raster.pixels.slice(0, 12)).every(Number.isFinite)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { makeRasterImagePdf } from './rasterPdf';

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);
function stream(bytes: Uint8Array, object: number) {
  const text = ascii(bytes),
    start = text.indexOf(`${object} 0 obj\n`);
  const offset = text.indexOf('stream\n', start) + 7;
  const length = Number(text.slice(start, offset).match(/\/Length (\d+)/)![1]);
  return bytes.slice(offset, offset + length);
}
describe('browser PDF image boundary', () => {
  it('packs every RGB triplet densely rather than retaining RGBA destination strides', () => {
    const pdf = makeRasterImagePdf(
      new Uint8Array([160, 136, 111, 255, 10, 20, 30, 255, 90, 80, 70, 255, 2, 3, 4, 255]),
      2,
      2,
    );
    expect(Array.from(stream(pdf, 4))).toEqual([160, 136, 111, 10, 20, 30, 90, 80, 70, 2, 3, 4]);
    expect(ascii(pdf)).not.toContain('/SMask');
  });
  it('retains zero and partial coverage as a separate soft mask', () => {
    const pdf = makeRasterImagePdf(
      new Uint8ClampedArray([200, 20, 10, 0, 50, 100, 150, 127]),
      2,
      1,
    );
    expect(Array.from(stream(pdf, 4))).toEqual([200, 20, 10, 50, 100, 150]);
    expect(Array.from(stream(pdf, 6))).toEqual([0, 127]);
    expect(ascii(pdf)).toContain('/SMask 6 0 R');
  });
  it('writes exact byte offsets for every object and the xref table', () => {
    const pdf = makeRasterImagePdf(new Uint8Array([0, 128, 255, 90]), 1, 1),
      text = ascii(pdf);
    const start = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const entries = text.slice(start).split('\n').slice(3, 9);
    entries.forEach((entry, i) => {
      expect(text.slice(Number(entry.slice(0, 10)))).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });
  it('rejects incomplete or noninteger raster buffers', () => {
    expect(() => makeRasterImagePdf(new Uint8Array(3), 1, 1)).toThrow();
    expect(() => makeRasterImagePdf(new Uint8Array(4), 1.5, 1)).toThrow();
  });
});

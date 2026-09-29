import { strFromU8, unzipSync, unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  makePresentationPdf,
  makePresentationPngArchive,
  type PresentationRasterPage,
} from './presentationFormats';

function findBytes(bytes: Uint8Array, needle: string, start = 0): number {
  const encoded = new TextEncoder().encode(needle);
  outer: for (let index = start; index <= bytes.length - encoded.length; index++) {
    for (let offset = 0; offset < encoded.length; offset++) {
      if (bytes[index + offset] !== encoded[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function page(width: number, height: number, rgba: number[]): PresentationRasterPage {
  return { width, height, pixels: new Uint8Array(rgba) };
}

describe('presentation output encoders', () => {
  it('builds a compressed raster PDF with one mixed-size page per slide', () => {
    const output = makePresentationPdf([
      page(2, 1, [255, 0, 0, 255, 0, 255, 0, 128]),
      page(1, 2, [0, 0, 255, 255, 255, 255, 255, 0]),
    ]);
    const source = strFromU8(output);

    expect(source).toContain('%PDF-1.4');
    expect(source).toContain('/Count 2');
    expect(source).toContain('/MediaBox [ 0 0 1.5 0.75 ]');
    expect(source).toContain('/MediaBox [ 0 0 0.75 1.5 ]');
    expect(source.match(/\/Filter \/FlateDecode/g)).toHaveLength(4);
    expect(source).toContain('startxref');
    expect(source.endsWith('%%EOF\n')).toBe(true);
  });

  it('rejects empty decks and unsafe raster dimensions', () => {
    expect(() => makePresentationPdf([])).toThrow(/at least one/);
    expect(() => makePresentationPdf([page(2, 2, [0, 0, 0, 255])])).toThrow(/64 million pixel/);
  });

  it('writes an ordered PNG archive with collision-safe slide names', () => {
    const output = makePresentationPngArchive([
      { title: 'Opening / Overview', png: new Uint8Array([1, 2, 3]) },
      { title: 'Opening: Overview', png: new Uint8Array([4, 5, 6]) },
      { title: 'Conclusion', png: new Uint8Array([7, 8, 9]) },
    ]);
    const files = unzipSync(output);
    expect(Object.keys(files)).toEqual([
      '01-Opening-Overview.png',
      '02-Opening-Overview.png',
      '03-Conclusion.png',
    ]);
    expect([...files['02-Opening-Overview.png']!]).toEqual([4, 5, 6]);
  });

  it('writes zlib-compressed PDF samples that decode to the captured page pixels', () => {
    const output = makePresentationPdf([page(1, 1, [12, 34, 56, 78])]);
    const imageStart = findBytes(output, '/ColorSpace /DeviceRGB');
    const lengthStart = findBytes(output, '/Length ', imageStart) + '/Length '.length;
    const lengthEnd = findBytes(output, ' >>\nstream\n', lengthStart);
    const imageStreamLength = Number(
      new TextDecoder().decode(output.slice(lengthStart, lengthEnd)),
    );
    const streamStart = lengthEnd + ' >>\nstream\n'.length;
    const compressed = output.slice(streamStart, streamStart + imageStreamLength);
    expect([...unzlibSync(compressed)]).toEqual([12, 34, 56]);
  });
});

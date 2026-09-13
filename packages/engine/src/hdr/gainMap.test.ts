import { readFileSync } from 'node:fs';
import { createRangeRaster, type RangeRaster } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  applyGainMap,
  assembleUltraHdrJpeg,
  decodeIsoGainMapMetadata,
  encodeGainMap,
  encodeIsoGainMapMetadata,
  GainMapError,
  isUltraHdrJpeg,
  parseGainMapXmpMetadata,
  parseUltraHdrJpeg,
  serializeGainMapXmpPrimary,
  serializeGainMapXmpSecondary,
} from './index';

const TINY_BASE = new Uint8Array(
  readFileSync(new URL('./__fixtures__/tiny-base.jpg', import.meta.url)),
);
const TINY_GAIN = new Uint8Array(
  readFileSync(new URL('./__fixtures__/tiny-gain.jpg', import.meta.url)),
);
const LIBULTRAHDR_REFERENCE = new Uint8Array(
  readFileSync(new URL('./__fixtures__/ultrahdr-iso-xmp-reference.jpg', import.meta.url)),
);

function makeRaster(
  width: number,
  height: number,
  fill: (x: number, y: number, channel: number) => number,
  options: {
    reference?: 'scene-linear' | 'display-linear';
    alpha?: (x: number, y: number) => number;
  } = {},
): RangeRaster {
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        pixels[index + channel] = fill(x, y, channel);
      }
      pixels[index + 3] = options.alpha ? options.alpha(x, y) : 1;
    }
  }
  return createRangeRaster(
    {
      width,
      height,
      stride: width * 4,
      channelLayout: 'rgba',
      sampleType: 'float32',
      encoding: {
        model: 'rgb',
        primaries: 'srgb',
        transfer: 'linear',
        bitDepth: 'float32',
        alphaMode: 'straight',
        provenance: 'named',
      },
      reference: options.reference ?? 'display-linear',
      referenceWhite: 1,
      alphaMode: 'straight',
      provenance: 'derived-display-preview',
    },
    pixels,
  );
}

function relativeError(expected: number, actual: number): number {
  return Math.abs(actual - expected) / Math.max(1e-6, Math.abs(expected));
}

describe('gain map encoding and application', () => {
  it('reconstructs distinguishable exposure ratios before any output transform', () => {
    // The HDR rendition uses 1x, 2x, and 4x boosts, i.e. 0, 1, and 2 stops.
    const width = 64;
    const height = 4;
    const sdr = makeRaster(width, height, (x) => 0.1 + (x / (width - 1)) * 0.5);
    const hdr = makeRaster(width, height, (x) => {
      const base = 0.1 + (x / (width - 1)) * 0.5;
      const stop = x < width / 3 ? 0 : x < (2 * width) / 3 ? 1 : 2;
      return base * 2 ** stop;
    });
    const encoded = encodeGainMap({ sdr, hdr }, { downsample: 1 });
    expect(encoded.diagnostics.maxReconstructionErrorStops).toBeLessThan(0.01);
    const reconstructed = applyGainMap(sdr, encoded.gainMap, encoded.metadata);
    for (const x of [2, Math.floor(width / 3) + 2, width - 3]) {
      const hdrIndex = (0 * width + x) * 4;
      expect(relativeError(hdr.pixels[hdrIndex]!, reconstructed.pixels[hdrIndex]!)).toBeLessThan(
        0.02,
      );
    }
  });

  it('preserves values well above display white', () => {
    const sdr = makeRaster(2, 1, () => 1);
    const hdr = makeRaster(2, 1, () => 8);
    const encoded = encodeGainMap({ sdr, hdr }, { channels: 1 });
    const expectedLog2 = Math.log2((8 + 1 / 64) / (1 + 1 / 64));
    expect(encoded.metadata.gainMapMax).toBeCloseTo(expectedLog2, 3);
    const reconstructed = applyGainMap(sdr, encoded.gainMap, encoded.metadata);
    expect(reconstructed.pixels[0]!).toBeGreaterThan(7.9);
    expect(reconstructed.pixels[0]!).toBeLessThan(8.1);
  });

  it('reconstructs each channel exactly with a per-channel map', () => {
    const multipliers = [1.5, 2.5, 4.5];
    const sdr = makeRaster(4, 1, (x) => 0.1 + x * 0.05);
    const hdr = makeRaster(
      4,
      1,
      (x, _y, channel) => (0.1 + x * 0.05) * multipliers[channel]! * (1 + x * 0.1),
    );
    const encoded = encodeGainMap({ sdr, hdr }, { channels: 3 });
    expect(Array.isArray(encoded.metadata.gainMapMax)).toBe(true);
    const reconstructed = applyGainMap(sdr, encoded.gainMap, encoded.metadata);
    for (let x = 0; x < 4; x++) {
      for (let channel = 0; channel < 3; channel++) {
        const index = x * 4 + channel;
        expect(relativeError(hdr.pixels[index]!, reconstructed.pixels[index]!)).toBeLessThan(0.01);
      }
    }
  });

  it('represents attenuation with a negative minimum boost', () => {
    const sdr = makeRaster(2, 1, () => 0.5);
    const hdr = makeRaster(2, 1, () => 0.25);
    const encoded = encodeGainMap({ sdr, hdr }, { channels: 1 });
    expect(encoded.metadata.gainMapMin).toBeLessThan(0);
    const reconstructed = applyGainMap(sdr, encoded.gainMap, encoded.metadata);
    expect(reconstructed.pixels[0]!).toBeCloseTo(0.25, 2);
  });

  it('handles a black SDR pixel with surviving HDR detail through the offsets', () => {
    const sdr = makeRaster(2, 1, () => 0);
    const hdr = makeRaster(2, 1, () => 0.5);
    const encoded = encodeGainMap({ sdr, hdr }, { channels: 1 });
    const reconstructed = applyGainMap(sdr, encoded.gainMap, encoded.metadata);
    expect(Number.isFinite(reconstructed.pixels[0]!)).toBe(true);
    expect(reconstructed.pixels[0]!).toBeCloseTo(0.5, 2);
  });

  it('keeps reconstruction error bounded with a 4x downsampled map', () => {
    const width = 128;
    const height = 64;
    const sdr = makeRaster(width, height, (x, y) => 0.05 + (x / width) * 0.4 + (y / height) * 0.2);
    const hdr = makeRaster(width, height, (x, y) => {
      const base = 0.05 + (x / width) * 0.4 + (y / height) * 0.2;
      return base * (1 + x / width);
    });
    const encoded = encodeGainMap({ sdr, hdr }, { downsample: 4 });
    expect(encoded.gainMap.width).toBe(width / 4);
    expect(encoded.gainMap.height).toBe(height / 4);
    expect(encoded.diagnostics.maxReconstructionErrorStops).toBeLessThan(0.1);
  });

  it('applies per-channel metadata to the matching channels', () => {
    const sdr = makeRaster(2, 1, () => 0.5);
    const gainMap = {
      data: Uint8Array.of(255, 255, 255),
      width: 1,
      height: 1,
      channels: 3 as const,
    };
    const reconstructed = applyGainMap(sdr, gainMap, {
      gainMapMin: 0,
      gainMapMax: [1, 2, 3],
      gamma: 1,
      offsetSdr: 0,
      offsetHdr: 0,
      hdrCapacityMin: 0,
      hdrCapacityMax: 3,
    });
    expect(reconstructed.pixels[0]!).toBeCloseTo(1, 6);
    expect(reconstructed.pixels[1]!).toBeCloseTo(2, 6);
    expect(reconstructed.pixels[2]!).toBeCloseTo(4, 6);
  });

  it('treats weight zero as the SDR rendition and rejects non-opaque input', () => {
    const sdr = makeRaster(1, 1, () => 0.4);
    const gainMap = { data: Uint8Array.of(255), width: 1, height: 1, channels: 1 as const };
    const metadata = {
      gainMapMin: 0,
      gainMapMax: 2,
      gamma: 1,
      offsetSdr: 0,
      offsetHdr: 0,
      hdrCapacityMin: 0,
      hdrCapacityMax: 2,
    };
    expect(applyGainMap(sdr, gainMap, metadata, { weight: 0 }).pixels[0]!).toBeCloseTo(0.4, 6);
    const transparent = makeRaster(1, 1, () => 0.4, { alpha: () => 0.5 });
    expect(() => encodeGainMap({ sdr: transparent, hdr: sdr })).toThrow(GainMapError);
  });

  it('rejects scene-linear input instead of guessing a display transform', () => {
    const scene = makeRaster(1, 1, () => 0.4, { reference: 'scene-linear' });
    expect(() => encodeGainMap({ sdr: scene, hdr: scene })).toThrow(/display-linear/);
  });
});

describe('gain map metadata serialization', () => {
  const metadata = {
    gainMapMin: -0.5,
    gainMapMax: 4.25,
    gamma: 1,
    offsetSdr: 1 / 64,
    offsetHdr: 1 / 64,
    hdrCapacityMin: 0,
    hdrCapacityMax: 4.25,
  };

  it('round-trips XMP metadata with the Android specification example fields', () => {
    const xmp = serializeGainMapXmpSecondary(metadata);
    const parsed = parseGainMapXmpMetadata(xmp);
    expect(parsed).not.toBeNull();
    expect(parsed!.gainMapMin).toBeCloseTo(-0.5, 6);
    expect(parsed!.gainMapMax).toBeCloseTo(4.25, 6);
    expect(parsed!.offsetSdr).toBeCloseTo(1 / 64, 6);
    expect(parsed!.hdrCapacityMax).toBeCloseTo(4.25, 6);
    expect(parsed!.hdrCapacityMin).toBe(0);
  });

  it('parses the published example values and three-channel arrays', () => {
    const parsed = parseGainMapXmpMetadata(`
      <rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"
        hdrgm:Version="1.0"
        hdrgm:GainMapMin="-0.57609993"
        hdrgm:GainMapMax="4.7090998,4.5,4.25"
        hdrgm:Gamma="1"
        hdrgm:OffsetSDR="0.015625"
        hdrgm:OffsetHDR="0.015625"
        hdrgm:HDRCapacityMin="0"
        hdrgm:HDRCapacityMax="4.7090998"
        hdrgm:BaseRenditionIsHDR="False"/>`);
    expect(parsed).not.toBeNull();
    expect(parsed!.gainMapMax).toEqual([4.7090998, 4.5, 4.25]);
  });

  it('rejects unsupported or incomplete XMP metadata', () => {
    expect(() =>
      parseGainMapXmpMetadata(
        '<rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0" hdrgm:BaseRenditionIsHDR="True" hdrgm:GainMapMax="2"/>',
      ),
    ).toThrow(/HDR-base/);
    expect(() =>
      parseGainMapXmpMetadata(
        '<rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"/>',
      ),
    ).toThrow(/GainMapMax/);
    expect(() =>
      parseGainMapXmpMetadata(
        '<rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="2.0" hdrgm:GainMapMax="2"/>',
      ),
    ).toThrow(/version/);
  });

  it('round-trips ISO 21496-1 metadata for one and three channels', () => {
    const single = decodeIsoGainMapMetadata(
      encodeIsoGainMapMetadata(metadata, { channelCount: 1 }),
    );
    expect(single).not.toBeNull();
    expect(single!.gainMapMin).toBeCloseTo(-0.5, 5);
    expect(single!.gainMapMax).toBeCloseTo(4.25, 5);
    expect(single!.hdrCapacityMax).toBeCloseTo(4.25, 5);
    const perChannel = {
      ...metadata,
      gainMapMax: [2, 3, 4] as const,
      gainMapMin: [0, -0.25, -0.5] as const,
    };
    const decoded = decodeIsoGainMapMetadata(
      encodeIsoGainMapMetadata(perChannel, { channelCount: 3 }),
    );
    expect(Array.isArray(decoded!.gainMapMax)).toBe(true);
    expect((decoded!.gainMapMax as readonly number[])[2]).toBeCloseTo(4, 4);
  });

  it('emits and reads a version-only ISO block for the primary image', () => {
    const versionOnly = encodeIsoGainMapMetadata(null);
    expect(versionOnly.length).toBe(4);
    expect(decodeIsoGainMapMetadata(versionOnly)).toBeNull();
  });

  it('rejects a truncated ISO block', () => {
    expect(() => decodeIsoGainMapMetadata(Uint8Array.of(0, 0, 0))).toThrow(GainMapError);
  });
});

function scanTail(bytes: Uint8Array): Uint8Array {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9) break;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker === 0xda) return bytes.subarray(offset);
    offset += 2 + length;
  }
  throw new Error('JPEG has no scan');
}

describe('Ultra HDR JPEG container', () => {
  const metadata = {
    gainMapMin: 0,
    gainMapMax: 3,
    gamma: 1,
    offsetSdr: 1 / 64,
    offsetHdr: 1 / 64,
    hdrCapacityMin: 0,
    hdrCapacityMax: 3,
  };

  it('assembles a container that preserves the base JPEG bytes and parses back', () => {
    const assembled = assembleUltraHdrJpeg({
      baseJpeg: TINY_BASE,
      gainMapJpeg: TINY_GAIN,
      metadata,
      gainMapChannels: 3,
    });
    const parsed = parseUltraHdrJpeg(assembled);
    expect(scanTail(parsed.baseJpeg)).toEqual(scanTail(TINY_BASE));
    expect(parsed.baseWidth).toBe(4);
    expect(parsed.baseHeight).toBe(4);
    expect(parsed.gainMapWidth).toBe(2);
    expect(parsed.gainMapHeight).toBe(2);
    expect(parsed.metadata).not.toBeNull();
    expect(parsed.metadataSource).toBe('iso');
    expect(parsed.metadata!.gainMapMax).toBeCloseTo(3, 4);
    const semantics = parsed.containerItems?.map((item) => item.semantic);
    expect(semantics).toEqual(['Primary', 'GainMap']);
    expect(parsed.gainMapJpeg![0]).toBe(0xff);
    expect(parsed.gainMapJpeg![1]).toBe(0xd8);
    expect(isUltraHdrJpeg(assembled)).toBe(true);
  });

  it('keeps the base scan and JFIF segment unchanged', () => {
    const assembled = assembleUltraHdrJpeg({
      baseJpeg: TINY_BASE,
      gainMapJpeg: TINY_GAIN,
      metadata,
    });
    const parsed = parseUltraHdrJpeg(assembled);
    expect(
      Buffer.from(parsed.baseJpeg.subarray(0, 20)).equals(Buffer.from(TINY_BASE.subarray(0, 20))),
    ).toBe(true);
    expect(Buffer.from(scanTail(parsed.baseJpeg)).equals(Buffer.from(scanTail(TINY_BASE)))).toBe(
      true,
    );
  });

  it('encodes the base length and secondary offset consistently', () => {
    const assembled = assembleUltraHdrJpeg({
      baseJpeg: TINY_BASE,
      gainMapJpeg: TINY_GAIN,
      metadata,
    });
    const parsed = parseUltraHdrJpeg(assembled);
    const primaryItem = parsed.containerItems?.find((item) => item.semantic === 'Primary');
    const gainItem = parsed.containerItems?.find((item) => item.semantic === 'GainMap');
    expect(primaryItem).toBeDefined();
    expect(gainItem?.length).toBe(assembled.length - parsed.baseJpeg.length);
    expect(parsed.baseJpeg.length).toBeLessThan(assembled.length);
  });

  it('parses the libultrahdr reference file and prefers ISO metadata', () => {
    const parsed = parseUltraHdrJpeg(LIBULTRAHDR_REFERENCE);
    expect(parsed.baseWidth).toBe(64);
    expect(parsed.baseHeight).toBe(48);
    expect(parsed.gainMapJpeg).not.toBeNull();
    expect(parsed.metadataSource).toBe('iso');
    expect(parsed.metadata!.gainMapMin).toBeCloseTo(0, 3);
    expect(parsed.metadata!.gainMapMax).toBeCloseTo(5.62238, 2);
    expect(parsed.metadata!.gamma).toBeCloseTo(1, 4);
    expect(parsed.metadata!.offsetSdr).toBeCloseTo(0, 4);
    expect(parsed.metadata!.hdrCapacityMax).toBeCloseTo(5.62238, 2);
  });

  it('falls back to XMP metadata when no ISO block is written', () => {
    const assembled = assembleUltraHdrJpeg({
      baseJpeg: TINY_BASE,
      gainMapJpeg: TINY_GAIN,
      metadata,
      metadataFormat: 'xmp',
    });
    const parsed = parseUltraHdrJpeg(assembled);
    expect(parsed.metadataSource).toBe('xmp-secondary');
    expect(parsed.metadata!.gainMapMax).toBeCloseTo(3, 5);
  });

  it('returns a no-gain-map result for an ordinary JPEG', () => {
    const parsed = parseUltraHdrJpeg(TINY_BASE);
    expect(parsed.metadata).toBeNull();
    expect(parsed.gainMapJpeg).toBeNull();
    expect(isUltraHdrJpeg(TINY_BASE)).toBe(false);
  });

  it('rejects malformed and truncated containers', () => {
    expect(() => parseUltraHdrJpeg(new Uint8Array(32))).toThrow(GainMapError);
    expect(() => parseUltraHdrJpeg(TINY_BASE.subarray(0, 20))).toThrow(GainMapError);
  });

  it('serializes a primary XMP directory with the secondary length', () => {
    const xmp = serializeGainMapXmpPrimary(1234);
    expect(xmp).toContain('Item:Length="1234"');
    expect(xmp).toContain('Item:Semantic="GainMap"');
  });
});

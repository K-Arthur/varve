import {
  applyGainMap,
  assembleUltraHdrJpeg,
  encodeGainMap,
  type GainMapDiagnostics,
  type GainMapMetadata,
  type GainMapRaster,
  parseUltraHdrJpeg,
  srgbToLinear,
} from '@varve/engine/hdr';
import { createRangeRaster, type RangeRaster } from '@varve/shared';
import { bytesToDataUrl, dataUrlToBytes } from './photoSourceWorkflow';

/**
 * Build a shareable Ultra HDR gain-map JPEG from the stored SDR rendition and
 * the range-bearing master's display-linear values.
 *
 * The SDR rendition is never regenerated from the master: it is decoded from
 * the persisted asset the user reviewed, so changing the HDR side cannot
 * silently alter the SDR fallback (the failure mode reported with other
 * editors). The recovery map is computed against the linear light of the
 * stored base pixels, which is what every decoder applies the map to.
 */

export interface UltraHdrExportRequest {
  /** Persisted SDR rendition data URL (PNG) that the user reviewed. */
  sdrRenditionDataUrl: string;
  /** Master display-linear values with the same output exposure; may exceed 1. */
  hdrDisplayLinear: RangeRaster;
  /** Base-image JPEG quality, 0.6 to 1. Default 0.92. */
  jpegQuality?: number;
  /** Gain-map JPEG quality, 0.6 to 1. Default 0.92. */
  gainMapQuality?: number;
  /** Gain-map resolution divisor: 1, 2, 4, or 8. Default 2. */
  gainMapDownsample?: 1 | 2 | 4 | 8;
  gainMapGamma?: number;
}

export interface UltraHdrExportVerification {
  /** Max |log2 error| in stops between reconstructed and requested HDR. */
  maxStops: number;
  /** 95th percentile |log2 error| in stops. */
  p95Stops: number;
  samples: number;
  /** Largest per-byte change in the SDR fallback introduced by JPEG encoding. */
  baseByteMaxDelta: number;
}

export interface UltraHdrExportResult {
  dataUrl: string;
  baseWidth: number;
  baseHeight: number;
  gainMapWidth: number;
  gainMapHeight: number;
  metadata: GainMapMetadata;
  diagnostics: GainMapDiagnostics;
  verification: UltraHdrExportVerification;
  warnings: string[];
}

function decodeImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        reject(new Error('Gain map export requires a 2D canvas'));
        return;
      }
      context.drawImage(image, 0, 0);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => reject(new Error('The stored SDR rendition could not be decoded'));
    image.src = dataUrl;
  });
}

function encodeJpeg(image: ImageData, quality: number): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Gain map export requires a 2D canvas');
  context.putImageData(image, 0, 0);
  return dataUrlToBytes(canvas.toDataURL('image/jpeg', quality));
}

function linearRasterFromImageData(image: ImageData): RangeRaster {
  const pixels = new Float32Array(image.width * image.height * 4);
  for (let index = 0; index < image.width * image.height; index++) {
    for (let channel = 0; channel < 3; channel++) {
      pixels[index * 4 + channel] = srgbToLinear(image.data[index * 4 + channel]! / 255);
    }
    pixels[index * 4 + 3] = 1;
  }
  return createRangeRaster(
    {
      width: image.width,
      height: image.height,
      stride: image.width * 4,
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
      reference: 'display-linear',
      referenceWhite: 1,
      alphaMode: 'straight',
      provenance: 'derived-display-preview',
    },
    pixels,
  );
}

function gainMapImageData(map: GainMapRaster): ImageData {
  const image = new ImageData(map.width, map.height);
  for (let index = 0; index < map.width * map.height; index++) {
    for (let channel = 0; channel < 3; channel++) {
      const value = map.channels === 1 ? map.data[index]! : map.data[index * 3 + channel]!;
      image.data[index * 4 + channel] = value;
    }
    image.data[index * 4 + 3] = 255;
  }
  return image;
}

function gainMapRasterFromImageData(image: ImageData): GainMapRaster {
  const data = new Uint8Array(image.width * image.height * 3);
  for (let index = 0; index < image.width * image.height; index++) {
    for (let channel = 0; channel < 3; channel++) {
      data[index * 3 + channel] = image.data[index * 4 + channel]!;
    }
  }
  return { data, width: image.width, height: image.height, channels: 3 };
}

function maxByteDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let worst = 0;
  for (let index = 0; index < a.length; index++) {
    const delta = Math.abs(a[index]! - b[index]!);
    if (delta > worst) worst = delta;
  }
  return worst;
}

function gainMapChannel(
  value: number | readonly [number, number, number],
  channel: number,
): number {
  return typeof value === 'number' ? value : value[channel]!;
}

export async function buildUltraHdrExport(
  request: UltraHdrExportRequest,
): Promise<UltraHdrExportResult> {
  const hdr = request.hdrDisplayLinear;
  if (hdr.contract.reference !== 'display-linear') {
    throw new Error('Gain map export requires display-linear master values');
  }
  const baseImage = await decodeImageData(request.sdrRenditionDataUrl);
  if (baseImage.width !== hdr.contract.width || baseImage.height !== hdr.contract.height) {
    throw new Error(
      `The SDR rendition is ${baseImage.width}x${baseImage.height} but the master is ${hdr.contract.width}x${hdr.contract.height}; reapply the SDR output transform for this master`,
    );
  }
  const storedLinear = linearRasterFromImageData(baseImage);
  const encoded = encodeGainMap(
    { sdr: storedLinear, hdr },
    {
      channels: 3,
      downsample: request.gainMapDownsample ?? 2,
      gamma: request.gainMapGamma ?? 1,
    },
  );
  const baseJpeg = encodeJpeg(baseImage, request.jpegQuality ?? 0.92);
  const gainMapJpeg = encodeJpeg(gainMapImageData(encoded.gainMap), request.gainMapQuality ?? 0.92);
  const container = assembleUltraHdrJpeg({
    baseJpeg,
    gainMapJpeg,
    metadata: encoded.metadata,
    gainMapChannels: 3,
  });

  // Verify the actual encoded file: decode the JPEG pair again and apply the
  // parsed metadata, rather than trusting the in-memory math.
  const parsed = parseUltraHdrJpeg(container);
  if (!parsed.metadata || !parsed.gainMapJpeg) {
    throw new Error('The exported gain map JPEG did not parse back with gain map metadata');
  }
  const decodedBase = await decodeImageData(bytesToDataUrl(parsed.baseJpeg, 'image/jpeg'));
  const decodedGainMap = await decodeImageData(bytesToDataUrl(parsed.gainMapJpeg, 'image/jpeg'));
  const decodedBaseLinear = linearRasterFromImageData(decodedBase);
  const reconstructed = applyGainMap(
    decodedBaseLinear,
    gainMapRasterFromImageData(decodedGainMap),
    parsed.metadata,
  );
  const samples: number[] = [];
  const pixelCount = hdr.contract.width * hdr.contract.height;
  const budget = 200_000;
  const step = Math.max(1, Math.floor(pixelCount / budget));
  const offsetHdr = [0, 1, 2].map((channel) => gainMapChannel(parsed.metadata!.offsetHdr, channel));
  let maxStops = 0;
  for (let index = 0; index < pixelCount; index += step) {
    for (let channel = 0; channel < 3; channel++) {
      const expected = hdr.pixels[index * 4 + channel]!;
      const actual = reconstructed.pixels[index * 4 + channel]!;
      // Near-black ratios are dominated by the offset and are not meaningful.
      if (!Number.isFinite(expected) || expected < 1e-4) continue;
      const error = Math.abs(
        Math.log2((actual + offsetHdr[channel]!) / (expected + offsetHdr[channel]!)),
      );
      if (Number.isFinite(error)) {
        samples.push(error);
        if (error > maxStops) maxStops = error;
      }
    }
  }
  samples.sort((a, b) => a - b);
  const p95Stops =
    samples.length > 0
      ? samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]!
      : 0;

  return {
    dataUrl: bytesToDataUrl(container, 'image/jpeg'),
    baseWidth: parsed.baseWidth,
    baseHeight: parsed.baseHeight,
    gainMapWidth: parsed.gainMapWidth,
    gainMapHeight: parsed.gainMapHeight,
    metadata: parsed.metadata,
    diagnostics: encoded.diagnostics,
    verification: {
      maxStops,
      p95Stops,
      samples: samples.length,
      baseByteMaxDelta: maxByteDelta(baseImage.data, decodedBase.data),
    },
    warnings: parsed.warnings,
  };
}

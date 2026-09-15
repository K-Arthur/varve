import {
  createRangeRaster,
  type RangeRaster,
  type RangeRasterContract,
  type RangeRasterProvenance,
  sanitizeRangeRasterInPlace,
  validateRangeRasterContract,
} from '@varve/shared';
import { type OpenExrDecodeResult, type OpenExrEncodeOptions, OpenExrError } from './types';

const EXR_MAGIC = 0x01312f76;
const EXR_VERSION = 2;
const MAX_EXR_BYTES = 512 * 1024 * 1024;
const MAX_EXR_CHANNELS = 4;
const MAX_EXR_DIMENSION = 32_768;

interface ExrAttribute {
  type: string;
  data: Uint8Array;
}

interface ExrChannel {
  name: string;
  pixelType: 1 | 2;
  byteWidth: 2 | 4;
}

/**
 * Encode the verified Varve subset of OpenEXR: one scanline part, no
 * compression, RGBA channels, finite float16 or float32 samples. The source
 * raster remains untouched. Unsupported deep, tiled, multipart, and compressed
 * output is rejected by the explicit contract rather than downgraded.
 */
export function encodeOpenExr(source: RangeRaster, options: OpenExrEncodeOptions = {}): Uint8Array {
  const precision = options.precision ?? 'float32';
  const halfOverflow = options.halfOverflow ?? 'reject';
  const includeAlpha = options.includeAlpha ?? true;
  if (precision !== 'float16' && precision !== 'float32') {
    throw new OpenExrError(`unsupported EXR precision: ${precision}`);
  }
  if (halfOverflow !== 'reject' && halfOverflow !== 'clamp') {
    throw new OpenExrError(`unsupported half overflow policy: ${halfOverflow}`);
  }
  const validation = validateRangeRasterContract(source.contract);
  if (!validation.valid) throw new OpenExrError(validation.errors.join('; '));
  const { width, height, stride } = source.contract;
  if (source.pixels.length < stride * height) {
    throw new OpenExrError('EXR source pixel buffer is truncated');
  }
  if (width > MAX_EXR_DIMENSION || height > MAX_EXR_DIMENSION) {
    throw new OpenExrError(`EXR dimension exceeds ${MAX_EXR_DIMENSION}px safety limit`);
  }
  const channels = includeAlpha ? ['B', 'G', 'R', 'A'] : ['B', 'G', 'R'];
  const bytesPerSample = precision === 'float16' ? 2 : 4;
  const bytesPerScanline = width * channels.length * bytesPerSample;
  if (!Number.isSafeInteger(bytesPerScanline) || bytesPerScanline <= 0) {
    throw new OpenExrError('EXR scanline size is unsafe');
  }

  const header = makeHeader(source.contract, channels, precision);
  const offsetTableLength = height * 8;
  const offsets = new Uint8Array(offsetTableLength);
  const scanlines: Uint8Array[] = [];
  let nextOffset = header.length + offsetTableLength;
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(8 + bytesPerScanline);
    const rowView = new DataView(row.buffer);
    rowView.setInt32(0, y, true);
    rowView.setUint32(4, bytesPerScanline, true);
    let cursor = 8;
    for (const channel of channels) {
      for (let x = 0; x < width; x++) {
        const sourceIndex = y * stride + x * 4;
        const sourceAlpha = source.pixels[sourceIndex + 3]!;
        if (!Number.isFinite(sourceAlpha)) {
          throw new OpenExrError(`non-finite alpha sample at (${x}, ${y})`);
        }
        const alpha = clampUnit(sourceAlpha);
        const raw =
          channel === 'R'
            ? source.pixels[sourceIndex]!
            : channel === 'G'
              ? source.pixels[sourceIndex + 1]!
              : channel === 'B'
                ? source.pixels[sourceIndex + 2]!
                : alpha;
        // OpenEXR RGB channels are conventionally premultiplied. If alpha is
        // deliberately omitted, the file is opaque and must retain straight
        // RGB rather than multiplying by a transparency value that is thrown
        // away.
        const value =
          channel === 'A' || !includeAlpha || source.contract.alphaMode === 'premultiplied'
            ? raw
            : raw * alpha;
        if (!Number.isFinite(value)) {
          throw new OpenExrError(`non-finite ${channel} sample at (${x}, ${y})`);
        }
        if (precision === 'float16') {
          rowView.setUint16(cursor, floatToHalf(value, halfOverflow), true);
          cursor += 2;
        } else {
          rowView.setFloat32(cursor, value, true);
          cursor += 4;
        }
      }
    }
    if (!Number.isSafeInteger(nextOffset)) throw new OpenExrError('EXR offset table overflow');
    new DataView(offsets.buffer).setBigUint64(y * 8, BigInt(nextOffset), true);
    scanlines.push(row);
    nextOffset += row.length;
  }
  const parts = [header, offsets, ...scanlines];
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  if (totalLength > MAX_EXR_BYTES) throw new OpenExrError('EXR output exceeds the safety limit');
  const output = new Uint8Array(totalLength);
  let outputOffset = 0;
  for (const part of parts) {
    output.set(part, outputOffset);
    outputOffset += part.length;
  }
  return output;
}

/** Decode the same single-part subset and restore the stored alpha semantics. */
export function decodeOpenExr(input: Uint8Array | ArrayBuffer): OpenExrDecodeResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_EXR_BYTES)
    throw new OpenExrError('EXR input exceeds the safety limit');
  if (bytes.byteLength < 12) throw new OpenExrError('EXR input is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== EXR_MAGIC) throw new OpenExrError('invalid OpenEXR magic');
  const version = view.getUint32(4, true);
  if ((version & 0xff) !== EXR_VERSION) throw new OpenExrError('unsupported OpenEXR version');
  if ((version & 0x1000) !== 0)
    throw new OpenExrError('tiled OpenEXR is not supported by this slice');
  if ((version & 0x2000) !== 0) throw new OpenExrError('long-name OpenEXR mode is not supported');
  if ((version & 0x4000) !== 0) throw new OpenExrError('deep OpenEXR is not supported');
  if ((version & 0x8000) !== 0) throw new OpenExrError('multipart OpenEXR is not supported');

  const attributes = new Map<string, ExrAttribute>();
  let offset = 8;
  while (true) {
    const name = readCString(bytes, offset, 'attribute name');
    offset = name.nextOffset;
    if (name.value.length === 0) break;
    const type = readCString(bytes, offset, 'attribute type');
    offset = type.nextOffset;
    if (offset + 4 > bytes.length) throw new OpenExrError('truncated EXR attribute size');
    const size = view.getUint32(offset, true);
    offset += 4;
    if (size > bytes.length - offset)
      throw new OpenExrError(`truncated EXR attribute ${name.value}`);
    if (attributes.has(name.value)) throw new OpenExrError(`duplicate EXR attribute ${name.value}`);
    attributes.set(name.value, { type: type.value, data: bytes.slice(offset, offset + size) });
    offset += size;
  }

  const channelsAttr = requiredAttribute(attributes, 'channels', 'chlist');
  const channels = parseChannels(channelsAttr.data);
  const compression = requiredAttribute(attributes, 'compression', 'compression').data;
  if (compression.length !== 1 || compression[0] !== 0) {
    throw new OpenExrError('only uncompressed scanline EXR is supported');
  }
  const dataWindow = parseBox(
    requiredAttribute(attributes, 'dataWindow', 'box2i').data,
    'dataWindow',
  );
  const displayWindow = parseBox(
    requiredAttribute(attributes, 'displayWindow', 'box2i').data,
    'displayWindow',
  );
  const width = checkedDimension(dataWindow.xMin, dataWindow.xMax, 'dataWindow width');
  const height = checkedDimension(dataWindow.yMin, dataWindow.yMax, 'dataWindow height');
  if (width > MAX_EXR_DIMENSION || height > MAX_EXR_DIMENSION) {
    throw new OpenExrError(`EXR dimension exceeds ${MAX_EXR_DIMENSION}px safety limit`);
  }
  if (channels.length > MAX_EXR_CHANNELS) throw new OpenExrError('too many EXR channels');
  const byName = new Map(channels.map((channel) => [channel.name, channel]));
  for (const name of ['R', 'G', 'B']) {
    if (!byName.has(name)) throw new OpenExrError(`EXR is missing required ${name} channel`);
  }
  const unknownChannels = channels.filter(
    (channel) => !['R', 'G', 'B', 'A'].includes(channel.name),
  );
  if (unknownChannels.length > 0) {
    throw new OpenExrError(`unsupported EXR channel: ${unknownChannels[0]!.name}`);
  }
  const bytesPerScanline = channels.reduce((sum, channel) => sum + width * channel.byteWidth, 0);
  const offsetTableBytes = height * 8;
  if (offset + offsetTableBytes > bytes.length)
    throw new OpenExrError('truncated EXR offset table');
  const outputContract = makeDecodedContract(attributes);
  const raster = createRangeRaster({ ...outputContract, width, height, stride: width * 4 });
  const seenRows = new Uint8Array(height);
  const warnings: string[] = [];
  let sawStraightMetadata = false;
  const alphaMode = stringAttribute(attributes, 'varveAlphaMode');
  if (alphaMode === 'straight') sawStraightMetadata = true;
  const offsetsView = new DataView(bytes.buffer, bytes.byteOffset + offset, offsetTableBytes);
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const rowOffsetBig = offsetsView.getBigUint64(rowIndex * 8, true);
    if (rowOffsetBig > BigInt(Number.MAX_SAFE_INTEGER))
      throw new OpenExrError('EXR scanline offset is unsafe');
    const rowOffset = Number(rowOffsetBig);
    if (rowOffset < offset + offsetTableBytes || rowOffset + 8 > bytes.length) {
      throw new OpenExrError('EXR scanline offset is outside the file');
    }
    const rowView = new DataView(
      bytes.buffer,
      bytes.byteOffset + rowOffset,
      bytes.length - rowOffset,
    );
    const y = rowView.getInt32(0, true);
    const payloadSize = rowView.getUint32(4, true);
    if (payloadSize < bytesPerScanline || rowOffset + 8 + payloadSize > bytes.length) {
      throw new OpenExrError('EXR scanline payload is truncated');
    }
    const destinationRow = y - dataWindow.yMin;
    if (destinationRow < 0 || destinationRow >= height || seenRows[destinationRow] !== 0) {
      throw new OpenExrError('EXR has a duplicate or out-of-window scanline');
    }
    seenRows[destinationRow] = 1;
    let channelOffset = 8;
    for (const channel of channels) {
      for (let x = 0; x < width; x++) {
        const valueOffset = channelOffset + x * channel.byteWidth;
        const stored =
          channel.pixelType === 1
            ? halfToFloat(rowView.getUint16(valueOffset, true))
            : rowView.getFloat32(valueOffset, true);
        if (!Number.isFinite(stored)) {
          throw new OpenExrError(`non-finite ${channel.name} sample in scanline ${y}`);
        }
        const destination = (destinationRow * width + x) * 4;
        if (channel.name === 'R') raster.pixels[destination] = stored;
        else if (channel.name === 'G') raster.pixels[destination + 1] = stored;
        else if (channel.name === 'B') raster.pixels[destination + 2] = stored;
        else raster.pixels[destination + 3] = clampUnit(stored);
      }
      channelOffset += width * channel.byteWidth;
    }
  }
  if (seenRows.some((value) => value === 0)) throw new OpenExrError('EXR is missing a scanline');
  for (let i = 0; i < width * height; i++) {
    const alphaIndex = i * 4 + 3;
    const alpha = byName.has('A') ? raster.pixels[alphaIndex]! : 1;
    raster.pixels[alphaIndex] = alpha;
    if (sawStraightMetadata) {
      if (alpha > 0) {
        raster.pixels[i * 4] = raster.pixels[i * 4]! / alpha;
        raster.pixels[i * 4 + 1] = raster.pixels[i * 4 + 1]! / alpha;
        raster.pixels[i * 4 + 2] = raster.pixels[i * 4 + 2]! / alpha;
      } else {
        raster.pixels[i * 4] = 0;
        raster.pixels[i * 4 + 1] = 0;
        raster.pixels[i * 4 + 2] = 0;
      }
    }
  }
  const sanitization = sanitizeRangeRasterInPlace(raster, { maxAbsRgb: 1e20 });
  if (sanitization.replacedNonFinite > 0) warnings.push('non-finite values were sanitized');
  if (channels.every((channel) => channel.pixelType === 1))
    warnings.push('decoded from half-float samples');
  return {
    raster,
    dataWindow,
    displayWindow,
    channels: channels.map((channel) => channel.name),
    warnings,
  };
}

function makeHeader(
  contract: RangeRasterContract,
  channelNames: string[],
  precision: 'float16' | 'float32',
): Uint8Array {
  const pixelType = precision === 'float16' ? 1 : 2;
  const channelPayload = new ByteBuilder();
  for (const name of channelNames) {
    channelPayload.string(name);
    channelPayload.i32(pixelType);
    channelPayload.u8(0);
    channelPayload.bytes(new Uint8Array(3));
    channelPayload.i32(1);
    channelPayload.i32(1);
  }
  channelPayload.u8(0);
  const header = new ByteBuilder();
  header.u32(EXR_MAGIC);
  header.u32(EXR_VERSION);
  header.attribute('channels', 'chlist', channelPayload.finish());
  header.attribute('compression', 'compression', new Uint8Array([0]));
  header.attribute(
    'dataWindow',
    'box2i',
    boxPayload(0, 0, contract.width - 1, contract.height - 1),
  );
  header.attribute(
    'displayWindow',
    'box2i',
    boxPayload(0, 0, contract.width - 1, contract.height - 1),
  );
  header.attribute('lineOrder', 'lineOrder', new Uint8Array([0]));
  header.attribute('pixelAspectRatio', 'float', floatPayload(1));
  header.attribute('screenWindowCenter', 'v2f', floatPairPayload(0, 0));
  header.attribute('screenWindowWidth', 'float', floatPayload(1));
  const chromaticities = chromaticitiesFor(contract.encoding.primaries);
  if (chromaticities)
    header.attribute('chromaticities', 'chromaticities', floatArrayPayload(chromaticities));
  header.attribute('varveAlphaMode', 'string', textPayload(contract.alphaMode));
  header.attribute('varveReference', 'string', textPayload(contract.reference));
  header.attribute('varveReferenceWhite', 'float', floatPayload(contract.referenceWhite));
  header.attribute('varveProvenance', 'string', textPayload(contract.provenance));
  header.attribute('varveEncodingProvenance', 'string', textPayload(contract.encoding.provenance));
  header.attribute(
    'varvePrimaries',
    'string',
    textPayload(contract.encoding.primaries ?? 'unknown'),
  );
  header.attribute('varveTransfer', 'string', textPayload(contract.encoding.transfer ?? 'unknown'));
  header.u8(0);
  return header.finish();
}

function parseChannels(data: Uint8Array): ExrChannel[] {
  const channels: ExrChannel[] = [];
  let offset = 0;
  while (true) {
    const name = readCString(data, offset, 'channel name');
    offset = name.nextOffset;
    if (name.value.length === 0) break;
    if (offset + 16 > data.length) throw new OpenExrError('truncated EXR channel entry');
    const view = new DataView(data.buffer, data.byteOffset + offset, data.length - offset);
    const pixelType = view.getInt32(0, true);
    if (pixelType !== 1 && pixelType !== 2)
      throw new OpenExrError(`unsupported EXR pixel type ${pixelType}`);
    if (channels.some((channel) => channel.name === name.value))
      throw new OpenExrError(`duplicate EXR channel ${name.value}`);
    channels.push({ name: name.value, pixelType, byteWidth: pixelType === 1 ? 2 : 4 });
    const xSampling = view.getInt32(8, true);
    const ySampling = view.getInt32(12, true);
    if (xSampling !== 1 || ySampling !== 1) {
      throw new OpenExrError('subsampled EXR channels are not supported');
    }
    offset += 16;
    if (channels.length > MAX_EXR_CHANNELS) throw new OpenExrError('too many EXR channels');
  }
  if (channels.length === 0) throw new OpenExrError('EXR has no channels');
  return channels;
}

function requiredAttribute(
  attributes: Map<string, ExrAttribute>,
  name: string,
  type: string,
): ExrAttribute {
  const attribute = attributes.get(name);
  if (!attribute) throw new OpenExrError(`EXR is missing ${name}`);
  if (attribute.type !== type)
    throw new OpenExrError(`EXR ${name} has type ${attribute.type}, expected ${type}`);
  return attribute;
}

function parseBox(data: Uint8Array, name: string) {
  if (data.length !== 16) throw new OpenExrError(`EXR ${name} must be a 16-byte box2i`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const box = {
    xMin: view.getInt32(0, true),
    yMin: view.getInt32(4, true),
    xMax: view.getInt32(8, true),
    yMax: view.getInt32(12, true),
  };
  if (box.xMax < box.xMin || box.yMax < box.yMin) throw new OpenExrError(`EXR ${name} is inverted`);
  return box;
}

function checkedDimension(min: number, max: number, label: string): number {
  const dimension = max - min + 1;
  if (!Number.isSafeInteger(dimension) || dimension <= 0)
    throw new OpenExrError(`invalid EXR ${label}`);
  return dimension;
}

function makeDecodedContract(attributes: Map<string, ExrAttribute>): RangeRasterContract {
  const primaries = parsePrimaries(stringAttribute(attributes, 'varvePrimaries'));
  const transfer = parseTransfer(stringAttribute(attributes, 'varveTransfer'));
  const reference = parseReference(stringAttribute(attributes, 'varveReference'));
  const provenance = parseRangeProvenance(stringAttribute(attributes, 'varveProvenance'));
  const encodingProvenance = parseEncodingProvenance(
    stringAttribute(attributes, 'varveEncodingProvenance'),
  );
  const referenceWhiteAttr = attributes.get('varveReferenceWhite');
  let referenceWhite = 1;
  if (referenceWhiteAttr) {
    if (referenceWhiteAttr.type !== 'float' || referenceWhiteAttr.data.length !== 4) {
      throw new OpenExrError('invalid varveReferenceWhite attribute');
    }
    referenceWhite = new DataView(
      referenceWhiteAttr.data.buffer,
      referenceWhiteAttr.data.byteOffset,
      referenceWhiteAttr.data.byteLength,
    ).getFloat32(0, true);
    if (!Number.isFinite(referenceWhite) || referenceWhite <= 0)
      throw new OpenExrError('invalid EXR reference white');
  }
  const alphaMode =
    stringAttribute(attributes, 'varveAlphaMode') === 'straight' ? 'straight' : 'premultiplied';
  return {
    width: 1,
    height: 1,
    stride: 4,
    channelLayout: 'rgba',
    sampleType: 'float32',
    encoding: {
      model: 'rgb',
      ...(primaries ? { primaries } : {}),
      ...(transfer ? { transfer } : {}),
      bitDepth: 'float32',
      alphaMode,
      provenance: encodingProvenance,
    },
    reference,
    referenceWhite,
    alphaMode,
    provenance,
  };
}

function stringAttribute(attributes: Map<string, ExrAttribute>, name: string): string | undefined {
  const attr = attributes.get(name);
  if (!attr) return undefined;
  if (attr.type !== 'string') throw new OpenExrError(`EXR ${name} must be a string`);
  return new TextDecoder().decode(attr.data);
}

function parsePrimaries(value: string | undefined): RangeRasterContract['encoding']['primaries'] {
  if (
    !value ||
    !['srgb', 'display-p3', 'adobe-rgb', 'pro-photo', 'rec2020', 'unknown'].includes(value)
  )
    return undefined;
  return value as RangeRasterContract['encoding']['primaries'];
}

function parseTransfer(value: string | undefined): RangeRasterContract['encoding']['transfer'] {
  if (
    !value ||
    ![
      'srgb',
      'gamma22',
      'gamma18',
      'prophoto',
      'rec2020',
      'linear',
      'pq',
      'hlg',
      'unknown',
    ].includes(value)
  )
    return undefined;
  return value as RangeRasterContract['encoding']['transfer'];
}

function parseReference(value: string | undefined): RangeRasterContract['reference'] {
  if (value === 'scene-linear' || value === 'display-linear' || value === 'display-referred')
    return value;
  return 'scene-linear';
}

function parseEncodingProvenance(
  value: string | undefined,
): RangeRasterContract['encoding']['provenance'] {
  if (
    !value ||
    ![
      'embedded-icc',
      'cicp',
      'named',
      'format-default',
      'user-assigned',
      'assumed',
      'legacy-assumed-srgb',
      'unknown',
    ].includes(value)
  )
    return 'unknown';
  return value as RangeRasterContract['encoding']['provenance'];
}

function parseRangeProvenance(value: string | undefined): RangeRasterProvenance {
  if (
    value === 'raw-development' ||
    value === 'hdr-radiance' ||
    value === 'hdr-exposure-fusion' ||
    value === 'rendered-image' ||
    value === 'derived-display-preview'
  ) {
    return value;
  }
  return 'rendered-image';
}

function chromaticitiesFor(name: RangeRasterContract['encoding']['primaries']): number[] | null {
  switch (name) {
    case 'srgb':
      return [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329];
    case 'display-p3':
      return [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.329];
    case 'rec2020':
      return [0.708, 0.292, 0.17, 0.797, 0.131, 0.046, 0.3127, 0.329];
    case 'adobe-rgb':
      return [0.64, 0.33, 0.21, 0.71, 0.15, 0.06, 0.3127, 0.329];
    case 'pro-photo':
      return [0.7347, 0.2653, 0.1596, 0.8404, 0.0366, 0.0001, 0.3457, 0.3585];
    default:
      return null;
  }
}

function boxPayload(xMin: number, yMin: number, xMax: number, yMax: number): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, xMin, true);
  view.setInt32(4, yMin, true);
  view.setInt32(8, xMax, true);
  view.setInt32(12, yMax, true);
  return bytes;
}

function floatPayload(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

function floatPairPayload(first: number, second: number): Uint8Array {
  return floatArrayPayload([first, second]);
}

function floatArrayPayload(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    view.setFloat32(index * 4, value, true);
  });
  return bytes;
}

function textPayload(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function readCString(
  bytes: Uint8Array,
  start: number,
  label: string,
): { value: string; nextOffset: number } {
  if (start < 0 || start >= bytes.length) throw new OpenExrError(`truncated EXR ${label}`);
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) end++;
  if (end >= bytes.length) throw new OpenExrError(`unterminated EXR ${label}`);
  return { value: new TextDecoder().decode(bytes.slice(start, end)), nextOffset: end + 1 };
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function floatToHalf(value: number, overflow: 'reject' | 'clamp'): number {
  if (!Number.isFinite(value)) throw new OpenExrError('half-float input must be finite');
  if (Math.abs(value) > 65504) {
    if (overflow === 'reject') throw new OpenExrError(`half-float overflow for value ${value}`);
    value = Math.sign(value) * 65504;
  }
  const float = new Float32Array([value]);
  const bits = new Uint32Array(float.buffer)[0]!;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  if (exponent === 0) return sign;
  if (exponent > 142) return sign | 0x7bff;
  if (exponent < 113) {
    const shift = 113 - exponent;
    const rounded = (0x800000 | mantissa) >>> Math.min(shift, 24);
    return sign | ((rounded + (rounded & 1)) >>> 1);
  }
  const halfExponent = exponent - 112;
  const halfMantissa = mantissa >>> 13;
  const roundBit = (mantissa >>> 12) & 1;
  return sign | (halfExponent << 10) | (halfMantissa + roundBit);
}

function halfToFloat(value: number): number {
  const sign = (value & 0x8000) << 16;
  const exponent = (value >>> 10) & 0x1f;
  const mantissa = value & 0x3ff;
  let bits: number;
  if (exponent === 0) {
    if (mantissa === 0) bits = sign;
    else {
      let normalized = mantissa;
      let shift = 0;
      while ((normalized & 0x400) === 0) {
        normalized <<= 1;
        shift++;
      }
      bits = sign | ((113 - shift) << 23) | ((normalized & 0x3ff) << 13);
    }
  } else if (exponent === 0x1f) {
    bits = sign | 0x7f800000 | (mantissa << 13);
  } else {
    bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
  }
  const output = new Uint32Array([bits]);
  return new Float32Array(output.buffer)[0]!;
}

class ByteBuilder {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  u8(value: number): void {
    this.bytes(new Uint8Array([value & 0xff]));
  }

  u32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.bytes(bytes);
  }

  i32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    this.bytes(bytes);
  }

  string(value: string): void {
    this.bytes(textPayload(value));
    this.u8(0);
  }

  attribute(name: string, type: string, payload: Uint8Array): void {
    this.string(name);
    this.string(type);
    this.u32(payload.length);
    this.bytes(payload);
  }

  bytes(value: Uint8Array): void {
    this.chunks.push(value);
    this.length += value.length;
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

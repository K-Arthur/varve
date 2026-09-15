import { type RawActiveArea, RawDecodeError, type RawMosaic } from './types';

const MAX_RAW_BYTES = 512 * 1024 * 1024;
const MAX_RAW_PIXELS = 64_000_000;
const MAX_RAW_DIMENSION = 32_768;
const MAX_IFD_ENTRIES = 4_096;
const MAX_IFD_CHAIN = 16;

const TIFF_TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};

interface TiffValue {
  type: number;
  count: number;
  bytes: Uint8Array;
  numbers: number[];
  text?: string;
}

type TiffIfd = Map<number, TiffValue>;

/** Return true only for a TIFF/DNG container signature, not a filename. */
export function isDngSignature(input: Uint8Array | ArrayBuffer): boolean {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8) return false;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint16(2, little) === 42;
}

/**
 * Decode a bounded, uncompressed Bayer/monochrome DNG raw IFD. Thumbnail and
 * preview IFDs are inspected only for metadata and are never used as pixels.
 * Compression, unsupported opcodes/delta calibration, X-Trans, and
 * already-linear RGB variants are rejected with an actionable diagnostic.
 */
export function decodeDng(input: Uint8Array | ArrayBuffer): RawMosaic {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_RAW_BYTES)
    throw new RawDecodeError('safety-limit', 'DNG exceeds the 512 MiB input limit');
  if (!isDngSignature(bytes))
    throw new RawDecodeError('invalid-container', 'input is not a classic TIFF/DNG container');
  const reader = new TiffReader(bytes);
  const firstIfdOffset = reader.u32(4);
  const ifds = collectIfds(reader, firstIfdOffset);
  const root = ifds[0]?.ifd;
  if (!root) throw new RawDecodeError('truncated', 'DNG has no primary IFD');
  const exifOffset = numberValue(root.get(34665));
  const exif = ifds.find(({ offset }) => offset === exifOffset)?.ifd;
  const rawEntry = ifds.find(({ ifd }) => isRawIfd(ifd));
  if (!rawEntry) {
    if (ifds.some(({ ifd }) => numberValue(ifd.get(262)) === 34892)) {
      throw new RawDecodeError(
        'unsupported-variant',
        'linear/demosaiced DNG is not a sensor mosaic',
      );
    }
    throw new RawDecodeError(
      'unsupported-variant',
      'DNG contains no supported Bayer or monochrome raw IFD',
    );
  }
  const raw = rawEntry.ifd;
  const merged = (tag: number): TiffValue | undefined => raw.get(tag) ?? root.get(tag);
  const width = positiveInteger(numberValue(merged(256)), 'ImageWidth');
  const height = positiveInteger(numberValue(merged(257)), 'ImageLength');
  if (width > MAX_RAW_DIMENSION || height > MAX_RAW_DIMENSION || width * height > MAX_RAW_PIXELS) {
    throw new RawDecodeError('safety-limit', 'DNG dimensions exceed the 64 megapixel safety limit');
  }
  const bits = integerValue(merged(258), 'BitsPerSample');
  if (![8, 10, 12, 14, 16].includes(bits)) {
    throw new RawDecodeError('unsupported-variant', `unsupported DNG sensor depth: ${bits} bits`);
  }
  const compression = integerValue(merged(259), 'Compression');
  if (compression !== 1) {
    throw new RawDecodeError(
      'unsupported-variant',
      `DNG compression ${compression} is not supported by the browser-safe decoder`,
    );
  }
  const samplesPerPixel = numberValue(merged(277)) ?? 1;
  if (samplesPerPixel !== 1) {
    throw new RawDecodeError(
      'unsupported-variant',
      'multi-sample or linear RGB DNG is not a supported sensor mosaic',
    );
  }
  const planarConfiguration = numberValue(merged(284)) ?? 1;
  if (planarConfiguration !== 1)
    throw new RawDecodeError('unsupported-variant', 'planar DNG storage is not supported');
  const fillOrder = numberValue(merged(266)) ?? 1;
  if (fillOrder !== 1)
    throw new RawDecodeError(
      'unsupported-variant',
      'reverse-bit-order DNG storage is not supported',
    );
  rejectRequiredProcessing(merged);

  const stripOffsets = integerValues(merged(273), 'StripOffsets');
  const stripByteCounts = integerValues(merged(279), 'StripByteCounts');
  if (
    stripOffsets.length === 0 ||
    stripOffsets.length !== stripByteCounts.length ||
    stripOffsets.length > 4096
  ) {
    throw new RawDecodeError('truncated', 'DNG strips are missing or inconsistent');
  }
  const rowsPerStrip = positiveInteger(numberValue(merged(278)) ?? height, 'RowsPerStrip');
  const rowBytes = Math.ceil((width * bits) / 8);
  const pixels = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    const stripIndex = Math.floor(y / rowsPerStrip);
    if (stripIndex >= stripOffsets.length)
      throw new RawDecodeError('truncated', 'DNG is missing a raw strip');
    const stripStart = safeOffset(stripOffsets[stripIndex]!, bytes.length, 'StripOffsets');
    const stripLength = safeLength(
      stripByteCounts[stripIndex]!,
      bytes.length - stripStart,
      'StripByteCounts',
    );
    const strip = bytes.subarray(stripStart, stripStart + stripLength);
    const rowInStrip = y - stripIndex * rowsPerStrip;
    const rowOffset = rowInStrip * rowBytes;
    if (rowOffset + rowBytes > strip.length)
      throw new RawDecodeError('truncated', `DNG raw strip ${stripIndex} is truncated`);
    for (let x = 0; x < width; x++) {
      const bitOffset = rowOffset * 8 + x * bits;
      pixels[y * width + x] =
        bits === 16
          ? reader.endian === 'little'
            ? reader.view.getUint16(stripStart + rowOffset + x * 2, true)
            : reader.view.getUint16(stripStart + rowOffset + x * 2, false)
          : readMsbBits(strip, bitOffset, bits);
    }
  }

  // DNG's LinearizationTable is a required sensor-domain mapping for some
  // otherwise ordinary Bayer files (including the legally redistributable
  // Leica M8 fixture used by the integration tests). Apply it before black/
  // white calibration; rejecting it would make the decoder fall back to the
  // embedded preview, while ignoring it would misstate sensor values.
  const linearization = merged(50712);
  let linearizationApplied = false;
  if (linearization) {
    const table = integerValues(linearization, 'LinearizationTable');
    if (table.length === 0)
      throw new RawDecodeError('invalid-calibration', 'LinearizationTable is empty');
    for (let index = 0; index < pixels.length; index++) {
      const rawValue = pixels[index]!;
      const mapped = table[rawValue];
      if (mapped === undefined)
        throw new RawDecodeError(
          'invalid-calibration',
          `LinearizationTable has no entry for raw sample ${rawValue}`,
        );
      if (mapped > 65_535)
        throw new RawDecodeError('invalid-calibration', 'LinearizationTable output exceeds uint16');
      pixels[index] = mapped;
    }
    linearizationApplied = true;
  }

  const photometric = numberValue(merged(262)) ?? 32803;
  const pattern = photometric === 32803 ? parseBayerPattern(merged) : undefined;
  if (photometric !== 32803 && photometric !== 1 && photometric !== 0) {
    throw new RawDecodeError(
      'unsupported-variant',
      `DNG photometric interpretation ${photometric} is unsupported`,
    );
  }
  const kind = pattern ? 'bayer' : 'monochrome';
  if (photometric === 32803 && !pattern)
    throw new RawDecodeError('unsupported-variant', 'DNG CFA pattern is not a 2x2 Bayer pattern');
  const blackLevel = calibrationValues(merged(50714), [0]);
  const whiteLevel = calibrationValues(merged(50717), [2 ** bits - 1]);
  if (
    whiteLevel.some(
      (white, index) => !Number.isFinite(white) || white <= (blackLevel[index] ?? blackLevel[0]!),
    )
  ) {
    throw new RawDecodeError(
      'invalid-calibration',
      'DNG black/white calibration levels are invalid',
    );
  }
  const activeArea = parseActiveArea(merged(50829), width, height);
  const defaultCrop = parseCrop(merged(50719), merged(50720), activeArea, width, height);
  const asShotNeutral = positiveValues(merged(50728), 3, 'AsShotNeutral');
  const colorMatrix1 = signedValues(merged(50721), 9, 'ColorMatrix1');
  const colorMatrix2 = signedValues(merged(50722), 9, 'ColorMatrix2');
  const calibrationIlluminant1 = positiveOptional(numberValue(merged(50778)));
  const calibrationIlluminant2 = positiveOptional(numberValue(merged(50779)));
  const orientation = parseOrientation(numberValue(root.get(274) ?? raw.get(274)));
  const metadataValue = (tag: number): TiffValue | undefined =>
    root.get(tag) ?? raw.get(tag) ?? exif?.get(tag);
  const camera = {
    make: cleanAscii(textValue(metadataValue(271))),
    model: cleanAscii(textValue(metadataValue(272))),
    uniqueModel: cleanAscii(textValue(metadataValue(50708))),
    dngVersion: dngVersion(root.get(50706) ?? raw.get(50706)),
    orientation,
    exposureTimeSeconds: positiveOptional(numberValue(metadataValue(33434))),
    fNumber: positiveOptional(rationalValue(metadataValue(33437))),
    iso: positiveOptional(numberValue(metadataValue(34855))),
    focalLengthMm: positiveOptional(rationalValue(metadataValue(37386))),
  };
  const warnings: string[] = [];
  if (linearizationApplied)
    warnings.push('DNG LinearizationTable was applied in the sensor domain');
  if (rawEntry.offset !== firstIfdOffset)
    warnings.push('embedded preview IFD was ignored; pixels came from the raw IFD');
  if (!asShotNeutral)
    warnings.push('no AsShotNeutral metadata; white balance starts from a neutral fallback');
  if (!colorMatrix1 && !colorMatrix2)
    warnings.push('no DNG camera color matrix; camera-matrix profile is unavailable');
  if (merged(50964) || merged(50965))
    warnings.push('DNG ForwardMatrix is present but not applied by this baseline renderer');
  if (colorMatrix1 && colorMatrix2)
    warnings.push(
      'both DNG camera matrices are present; automatic selection uses known illuminants',
    );
  if (merged(50718)) warnings.push('BaselineExposure is recorded but not applied automatically');
  if (merged(50734))
    warnings.push('LinearResponseLimit is recorded but not applied by this baseline decoder');
  return {
    width,
    height,
    pixels,
    bitDepth: bits as 8 | 10 | 12 | 14 | 16,
    kind,
    ...(pattern ? { cfaPattern: pattern } : {}),
    blackLevel,
    whiteLevel,
    activeArea,
    ...(defaultCrop ? { defaultCrop } : {}),
    ...(asShotNeutral ? { asShotNeutral } : {}),
    ...(colorMatrix1 ? { colorMatrix1 } : {}),
    ...(colorMatrix2 ? { colorMatrix2 } : {}),
    ...(calibrationIlluminant1 ? { calibrationIlluminant1 } : {}),
    ...(calibrationIlluminant2 ? { calibrationIlluminant2 } : {}),
    ...(linearizationApplied ? { linearizationApplied } : {}),
    camera,
    sourceFormat: pattern ? 'dng-bayer-uncompressed' : 'dng-monochrome-uncompressed',
    warnings,
  };
}

function isRawIfd(ifd: TiffIfd): boolean {
  const photometric = numberValue(ifd.get(262));
  const samples = numberValue(ifd.get(277)) ?? 1;
  const bits = numberValue(ifd.get(258));
  return (
    (photometric === 32803 || photometric === 1 || photometric === 0) &&
    samples === 1 &&
    bits !== undefined
  );
}

function collectIfds(
  reader: TiffReader,
  firstOffset: number,
): Array<{ offset: number; ifd: TiffIfd }> {
  const queue = [firstOffset];
  const seen = new Set<number>();
  const result: Array<{ offset: number; ifd: TiffIfd }> = [];
  while (queue.length > 0 && result.length < MAX_IFD_CHAIN) {
    const offset = queue.shift()!;
    if (seen.has(offset)) continue;
    seen.add(offset);
    const ifd = reader.ifd(offset);
    result.push({ offset, ifd });
    for (const child of integerValues(ifd.get(330), 'SubIFDs')) {
      if (child > 0 && !seen.has(child)) queue.push(child);
    }
    const exif = numberValue(ifd.get(34665));
    if (exif && !seen.has(exif)) queue.push(exif);
  }
  if (queue.length > 0)
    throw new RawDecodeError('safety-limit', 'DNG IFD graph exceeds the safety limit');
  return result;
}

function parseBayerPattern(
  get: (tag: number) => TiffValue | undefined,
): readonly [number, number, number, number] | undefined {
  const dimensions = integerValues(get(33421), 'CFARepeatPatternDim');
  const pattern = get(33422)?.bytes;
  if (dimensions.length >= 2 && (dimensions[0] !== 2 || dimensions[1] !== 2)) return undefined;
  if (!pattern || pattern.length < 4) return undefined;
  const values = [pattern[0]!, pattern[1]!, pattern[2]!, pattern[3]!];
  if (values.some((value) => value > 3)) return undefined;
  return values as [number, number, number, number];
}

function rejectRequiredProcessing(get: (tag: number) => TiffValue | undefined): void {
  const requiredTags: Array<[number, string]> = [
    [50715, 'BlackLevelDeltaH'],
    [50716, 'BlackLevelDeltaV'],
    [51008, 'OpcodeList1'],
    [51009, 'OpcodeList2'],
    [51010, 'OpcodeList3'],
  ];
  for (const [tag, name] of requiredTags) {
    const value = get(tag);
    if (value && value.bytes.length > 0) {
      throw new RawDecodeError(
        'unsupported-variant',
        `required DNG processing ${name} is not supported`,
      );
    }
  }
}

function parseActiveArea(
  value: TiffValue | undefined,
  width: number,
  height: number,
): RawActiveArea {
  const numbers = integerValues(value, 'ActiveArea');
  const area =
    numbers.length >= 4
      ? { top: numbers[0]!, left: numbers[1]!, bottom: numbers[2]!, right: numbers[3]! }
      : { top: 0, left: 0, bottom: height, right: width };
  if (
    area.top < 0 ||
    area.left < 0 ||
    area.bottom <= area.top ||
    area.right <= area.left ||
    area.bottom > height ||
    area.right > width
  )
    throw new RawDecodeError('invalid-calibration', 'DNG ActiveArea is outside the raw image');
  return area;
}

function parseCrop(
  originValue: TiffValue | undefined,
  sizeValue: TiffValue | undefined,
  activeArea: RawActiveArea,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!originValue || !sizeValue) return undefined;
  const origin = rationalValues(originValue, 'DefaultCropOrigin');
  const size = rationalValues(sizeValue, 'DefaultCropSize');
  if (origin.length < 2 || size.length < 2) return undefined;
  const crop = {
    x: Math.round(origin[0]!),
    y: Math.round(origin[1]!),
    width: Math.round(size[0]!),
    height: Math.round(size[1]!),
  };
  if (
    crop.x < activeArea.left ||
    crop.y < activeArea.top ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > Math.min(width, activeArea.right) ||
    crop.y + crop.height > Math.min(height, activeArea.bottom)
  )
    throw new RawDecodeError('invalid-calibration', 'DNG DefaultCrop is outside ActiveArea');
  return crop;
}

function calibrationValues(value: TiffValue | undefined, fallback: number[]): number[] {
  const values = value ? rationalValues(value, 'calibration') : fallback;
  return values.length > 0 && values.every((number) => Number.isFinite(number) && number >= 0)
    ? values
    : fallback;
}

function positiveValues(
  value: TiffValue | undefined,
  minCount: number,
  name: string,
): number[] | undefined {
  if (!value) return undefined;
  const values = rationalValues(value, name);
  if (
    values.length < minCount ||
    values.some((number) => !Number.isFinite(number) || number <= 0)
  ) {
    throw new RawDecodeError('invalid-calibration', `${name} contains invalid values`);
  }
  return values;
}

function signedValues(
  value: TiffValue | undefined,
  minCount: number,
  name: string,
): number[] | undefined {
  if (!value) return undefined;
  const values = rationalValues(value, name);
  if (values.length < minCount || values.some((number) => !Number.isFinite(number))) {
    throw new RawDecodeError('invalid-calibration', `${name} contains invalid values`);
  }
  return values;
}

function readMsbBits(bytes: Uint8Array, bitOffset: number, bitCount: number): number {
  let output = 0;
  for (let bit = 0; bit < bitCount; bit++) {
    const absolute = bitOffset + bit;
    const byte = bytes[Math.floor(absolute / 8)];
    if (byte === undefined)
      throw new RawDecodeError('truncated', 'packed DNG sample exceeds its strip');
    output = (output << 1) | ((byte >>> (7 - (absolute % 8))) & 1);
  }
  return output;
}

function positiveInteger(value: number | undefined, name: string): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0)
    throw new RawDecodeError('invalid-container', `${name} is invalid`);
  return value;
}

function integerValue(value: TiffValue | undefined, name: string): number {
  return positiveInteger(numberValue(value), name);
}

function integerValues(value: TiffValue | undefined, name: string): number[] {
  if (!value) return [];
  if (
    value.numbers.length === 0 ||
    value.numbers.some((number) => !Number.isSafeInteger(number) || number < 0)
  ) {
    throw new RawDecodeError('invalid-container', `${name} contains invalid offsets or counts`);
  }
  return value.numbers;
}

function numberValue(value: TiffValue | undefined): number | undefined {
  return value?.numbers[0];
}

function rationalValue(value: TiffValue | undefined): number | undefined {
  return value?.numbers[0];
}

function rationalValues(value: TiffValue, name: string): number[] {
  if (value.numbers.length === 0 || value.numbers.some((number) => !Number.isFinite(number))) {
    throw new RawDecodeError('invalid-calibration', `${name} contains non-finite values`);
  }
  return value.numbers;
}

function positiveOptional(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function cleanAscii(value: string | undefined): string | undefined {
  const text = value?.replaceAll('\0', '').trim();
  return text ? text : undefined;
}

function textValue(value: TiffValue | undefined): string | undefined {
  return value?.text;
}

function dngVersion(value: TiffValue | undefined): string | undefined {
  if (!value || value.bytes.length < 4) return undefined;
  return Array.from(value.bytes.slice(0, 4)).join('.');
}

function parseOrientation(value: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
  return Number.isInteger(value) && value! >= 1 && value! <= 8
    ? (value as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8)
    : 1;
}

function safeOffset(value: number, total: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= total)
    throw new RawDecodeError('truncated', `${name} points outside the DNG`);
  return value;
}

function safeLength(value: number, remaining: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > remaining)
    throw new RawDecodeError('truncated', `${name} exceeds the DNG`);
  return value;
}

class TiffReader {
  readonly view: DataView;
  readonly endian: 'little' | 'big';

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const little = bytes[0] === 0x49 && bytes[1] === 0x49;
    if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) {
      throw new RawDecodeError('invalid-container', 'invalid TIFF byte order');
    }
    this.endian = little ? 'little' : 'big';
    if (this.u16(2) !== 42)
      throw new RawDecodeError('unsupported-variant', 'BigTIFF is not supported by this decoder');
  }

  u16(offset: number): number {
    this.ensure(offset, 2);
    return this.view.getUint16(offset, this.endian === 'little');
  }

  u32(offset: number): number {
    this.ensure(offset, 4);
    return this.view.getUint32(offset, this.endian === 'little');
  }

  s32(offset: number): number {
    this.ensure(offset, 4);
    return this.view.getInt32(offset, this.endian === 'little');
  }

  f32(offset: number): number {
    this.ensure(offset, 4);
    return this.view.getFloat32(offset, this.endian === 'little');
  }

  f64(offset: number): number {
    this.ensure(offset, 8);
    return this.view.getFloat64(offset, this.endian === 'little');
  }

  ifd(offset: number): TiffIfd {
    if (!Number.isSafeInteger(offset) || offset < 8 || offset + 2 > this.bytes.length) {
      throw new RawDecodeError('truncated', 'DNG IFD offset is outside the file');
    }
    const count = this.u16(offset);
    if (count > MAX_IFD_ENTRIES || offset + 2 + count * 12 + 4 > this.bytes.length) {
      throw new RawDecodeError('safety-limit', 'DNG IFD is too large or truncated');
    }
    const ifd: TiffIfd = new Map();
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const tag = this.u16(entry);
      const type = this.u16(entry + 2);
      const itemSize = TIFF_TYPE_SIZE[type];
      const itemCount = this.u32(entry + 4);
      if (!itemSize || itemCount > 1_000_000 || itemCount * itemSize > MAX_RAW_BYTES) {
        throw new RawDecodeError('safety-limit', `DNG tag ${tag} has an unsafe value size`);
      }
      const byteLength = itemCount * itemSize;
      const valueOffset = byteLength <= 4 ? entry + 8 : this.u32(entry + 8);
      if (valueOffset < 0 || valueOffset + byteLength > this.bytes.length) {
        throw new RawDecodeError('truncated', `DNG tag ${tag} points outside the file`);
      }
      const bytes = this.bytes.slice(valueOffset, valueOffset + byteLength);
      if (!ifd.has(tag))
        ifd.set(tag, {
          type,
          count: itemCount,
          bytes,
          numbers: this.decodeNumbers(type, itemCount, valueOffset),
          ...(type === 2 ? { text: new TextDecoder().decode(bytes) } : {}),
        });
    }
    return ifd;
  }

  private decodeNumbers(type: number, count: number, offset: number): number[] {
    const values: number[] = [];
    for (let index = 0; index < count; index++) {
      const at = offset + index * (TIFF_TYPE_SIZE[type] ?? 1);
      switch (type) {
        case 1:
        case 6:
        case 7:
          values.push(
            type === 6
              ? new Int8Array(this.bytes.buffer, this.bytes.byteOffset + at, 1)[0]!
              : this.bytes[at]!,
          );
          break;
        case 3:
          values.push(this.u16(at));
          break;
        case 4:
        case 13:
          values.push(this.u32(at));
          break;
        case 8:
          values.push(this.view.getInt16(at, this.endian === 'little'));
          break;
        case 9:
          values.push(this.s32(at));
          break;
        case 5:
          values.push(this.u32(at * 1) / this.u32(at + 4));
          break;
        case 10: {
          const denominator = this.s32(at + 4);
          values.push(denominator === 0 ? Number.NaN : this.s32(at) / denominator);
          break;
        }
        case 11:
          values.push(this.f32(at));
          break;
        case 12:
          values.push(this.f64(at));
          break;
        case 2:
          break;
        default:
          throw new RawDecodeError('unsupported-variant', `unsupported TIFF field type ${type}`);
      }
    }
    return values;
  }

  private ensure(offset: number, length: number): void {
    if (offset < 0 || offset + length > this.bytes.length)
      throw new RawDecodeError('truncated', 'DNG field is truncated');
  }
}

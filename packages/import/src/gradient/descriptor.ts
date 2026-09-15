/**
 * Bounded big-endian byte reader + 8BIM descriptor parser for Photoshop
 * preset files (`.grd`).
 *
 * Safety contract:
 *  - Every read checks bounds against the underlying buffer; a read past the
 *    end throws `GrdError('truncated')` instead of returning garbage.
 *  - Collection counts are validated against remaining bytes before any loop,
 *    and against `MAX_DESCRIPTOR_DEPTH` / `MAX_COLLECTION_ITEMS` to prevent
 *    unbounded recursion or allocation.
 *  - Descriptor recursion is depth-limited; file-controlled counts can never
 *    drive unbounded memory use.
 *  - Embedded names/type keys are treated as untrusted data: decoded, never
 *    executed.
 */

export const GRD_LIMITS = {
  /** Max file size accepted by the parser (bytes). */
  maxFileSize: 5 * 1024 * 1024,
  /** Max gradients per file. */
  maxGradients: 2000,
  /** Max color stops per gradient. */
  maxColorStops: 256,
  /** Max opacity stops per gradient. */
  maxOpacityStops: 256,
  /** Max name length in characters. */
  maxNameLength: 4096,
  /** Max descriptor recursion depth. */
  maxDescriptorDepth: 32,
  /** Max items in a single VlLs collection. */
  maxCollectionItems: 100_000,
  /** Max TEXT payload in bytes. */
  maxTextBytes: 1024 * 1024,
  /** Window scanned for the descriptor anchor. */
  maxAnchorScan: 512,
} as const;

export type GrdErrorCode =
  | 'unsupported-format'
  | 'truncated'
  | 'invalid-signature'
  | 'invalid-version'
  | 'impossible-offset'
  | 'invalid-count'
  | 'unsupported-descriptor'
  | 'unsupported-color-model'
  | 'corrupt-name'
  | 'excessive-resource'
  | 'no-usable-gradients';

export class GrdError extends Error {
  readonly code: GrdErrorCode;
  constructor(code: GrdErrorCode, message: string) {
    super(message);
    this.name = 'GrdError';
    this.code = code;
  }
}

export class ByteReader {
  private readonly view: DataView;
  private pos = 0;

  constructor(
    readonly buffer: ArrayBuffer,
    private readonly start = 0,
    private readonly end = buffer.byteLength,
  ) {
    this.view = new DataView(buffer);
  }

  get position(): number {
    return this.pos + this.start;
  }

  get length(): number {
    return this.end - this.start;
  }

  get remaining(): number {
    return this.end - (this.pos + this.start);
  }

  private require(n: number, context: string): void {
    if (n < 0 || this.pos + n > this.end - this.start) {
      throw new GrdError('truncated', `File ended unexpectedly while reading ${context}`);
    }
  }

  seek(offset: number): void {
    if (offset < this.start || offset > this.end) {
      throw new GrdError('impossible-offset', `Seek to ${offset} is outside the buffer`);
    }
    this.pos = offset - this.start;
  }

  skip(n: number, context: string): void {
    this.require(n, context);
    this.pos += n;
  }

  readUint8(context: string): number {
    this.require(1, context);
    return this.view.getUint8(this.pos++ + this.start);
  }

  readInt16(context: string): number {
    this.require(2, context);
    const v = this.view.getInt16(this.pos + this.start, false);
    this.pos += 2;
    return v;
  }

  readUint16(context: string): number {
    this.require(2, context);
    const v = this.view.getUint16(this.pos + this.start, false);
    this.pos += 2;
    return v;
  }

  readInt32(context: string): number {
    this.require(4, context);
    const v = this.view.getInt32(this.pos + this.start, false);
    this.pos += 4;
    return v;
  }

  readUint32(context: string): number {
    this.require(4, context);
    const v = this.view.getUint32(this.pos + this.start, false);
    this.pos += 4;
    return v;
  }

  readFloat32(context: string): number {
    this.require(4, context);
    const v = this.view.getFloat32(this.pos + this.start, false);
    this.pos += 4;
    return v;
  }

  readFloat64(context: string): number {
    this.require(8, context);
    const v = this.view.getFloat64(this.pos + this.start, false);
    this.pos += 8;
    return v;
  }

  readBytes(n: number, context: string): Uint8Array {
    this.require(n, context);
    const out = new Uint8Array(this.view.buffer, this.pos + this.start, n);
    this.pos += n;
    return out;
  }

  /** Read `n` ASCII bytes as a string. */
  readAscii(n: number, context: string): string {
    const bytes = this.readBytes(n, context);
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]!);
    }
    return s;
  }

  /** Read `count` UTF-16BE code units as a string. */
  readUtf16Be(count: number, context: string): string {
    this.require(count * 2, context);
    let s = '';
    for (let i = 0; i < count; i++) {
      s += String.fromCharCode(this.view.getUint16(this.pos + this.start, false));
      this.pos += 2;
    }
    return s;
  }

  /**
   * Read a pascal string: uint16 length + bytes, padded to even length.
   * Returns the decoded string and the bytes consumed (including padding).
   */
  readPascalString(context: string): { value: string; consumed: number } {
    const startPos = this.pos;
    const len = this.readUint16(`${context}.length`);
    const bytes = this.readBytes(len, `${context}.value`);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    if ((len & 1) === 1) this.skip(1, `${context}.pad`);
    return { value: s, consumed: this.pos - startPos };
  }
}

export interface DescriptorNode {
  /** 4-byte type key (also the OSTypeKey for the value). */
  type: string;
}

export interface DescriptorObjc extends DescriptorNode {
  type: 'Objc';
  name: string;
  typename: string;
  props: Record<string, DescriptorValue>;
}

export interface DescriptorVlLs extends DescriptorNode {
  type: 'VlLs';
  items: DescriptorValue[];
}

export interface DescriptorScalar extends DescriptorNode {
  type: 'doub' | 'long' | 'UntF' | 'TEXT' | 'enum' | 'bool' | 'tdtd' | 'UnFl';
  value: number | string | boolean | Uint8Array;
  unit?: string;
  enumType?: string;
  enumValue?: string;
}

export type DescriptorValue = DescriptorObjc | DescriptorVlLs | DescriptorScalar;

const MAX_DEPTH = GRD_LIMITS.maxDescriptorDepth;

function parseDescriptor(reader: ByteReader, depth: number): DescriptorValue {
  if (depth > MAX_DEPTH) {
    throw new GrdError('excessive-resource', 'Descriptor nesting exceeds the safety limit');
  }
  const typeKey = reader.readAscii(4, 'descriptor.type');
  switch (typeKey) {
    case 'Objc': {
      const nameLen = reader.readInt32('Objc.nameLength');
      if (nameLen < 0 || nameLen > GRD_LIMITS.maxNameLength) {
        throw new GrdError('corrupt-name', `Unreasonable descriptor name length: ${nameLen}`);
      }
      const name = reader.readUtf16Be(nameLen, 'Objc.name');
      const typeLen = reader.readInt32('Objc.typeLength');
      const typename = reader.readAscii(typeLen > 0 ? typeLen : 4, 'Objc.type');
      const propCount = reader.readInt32('Objc.propertyCount');
      if (propCount < 0 || propCount > GRD_LIMITS.maxCollectionItems) {
        throw new GrdError('invalid-count', `Unreasonable property count: ${propCount}`);
      }
      const props: Record<string, DescriptorValue> = {};
      for (let i = 0; i < propCount; i++) {
        const keyLen = reader.readInt32('Objc.keyLength');
        const key = reader.readAscii(keyLen > 0 ? keyLen : 4, 'Objc.key');
        props[key] = parseDescriptor(reader, depth + 1);
      }
      return { type: 'Objc', name, typename, props };
    }
    case 'VlLs': {
      const count = reader.readInt32('VlLs.count');
      if (count < 0 || count > GRD_LIMITS.maxCollectionItems) {
        throw new GrdError('invalid-count', `Unreasonable list count: ${count}`);
      }
      // Reject counts that cannot fit in the remaining buffer (each item is
      // at least 4 bytes for its type key + 1 byte payload).
      if (count > 0 && reader.remaining / 5 < count) {
        throw new GrdError(
          'truncated',
          `List of ${count} items cannot fit in remaining ${reader.remaining} bytes`,
        );
      }
      const items: DescriptorValue[] = [];
      for (let i = 0; i < count; i++) {
        items.push(parseDescriptor(reader, depth + 1));
      }
      return { type: 'VlLs', items };
    }
    case 'doub':
      return { type: 'doub', value: reader.readFloat64('doub') };
    case 'UnFl':
      return { type: 'UnFl', value: reader.readFloat32('UnFl') };
    case 'long':
      return { type: 'long', value: reader.readInt32('long') };
    case 'UntF': {
      const unit = reader.readAscii(4, 'UntF.unit');
      const value = reader.readFloat64('UntF.value');
      return { type: 'UntF', value, unit };
    }
    case 'TEXT': {
      const len = reader.readInt32('TEXT.length');
      if (len < 0 || len > GRD_LIMITS.maxTextBytes) {
        throw new GrdError('excessive-resource', `Unreasonable TEXT length: ${len}`);
      }
      return { type: 'TEXT', value: reader.readUtf16Be(len, 'TEXT.value') };
    }
    case 'enum': {
      const typeLen = reader.readInt32('enum.typeLength');
      const enumType = reader.readAscii(typeLen > 0 ? typeLen : 4, 'enum.type');
      const valLen = reader.readInt32('enum.valueLength');
      const enumValue = reader.readAscii(valLen > 0 ? valLen : 4, 'enum.value');
      return { type: 'enum', value: enumValue, enumType, enumValue };
    }
    case 'bool':
      return { type: 'bool', value: reader.readUint8('bool') !== 0 };
    case 'tdtd': {
      const len = reader.readInt32('tdtd.length');
      if (len < 0 || len > GRD_LIMITS.maxTextBytes) {
        throw new GrdError('excessive-resource', `Unreasonable raw data length: ${len}`);
      }
      return { type: 'tdtd', value: reader.readBytes(len, 'tdtd.value') };
    }
    default:
      throw new GrdError(
        'unsupported-descriptor',
        `Unknown descriptor type "${typeKey}" at offset ${reader.position}`,
      );
  }
}

/** Numeric helpers over the descriptor tree. */
export function asObjc(v: DescriptorValue | undefined, context: string): DescriptorObjc {
  if (v?.type !== 'Objc') {
    throw new GrdError('unsupported-descriptor', `Expected Objc at ${context}`);
  }
  return v;
}

export function asList(v: DescriptorValue | undefined, context: string): DescriptorVlLs {
  if (v?.type !== 'VlLs') {
    throw new GrdError('unsupported-descriptor', `Expected VlLs at ${context}`);
  }
  return v;
}

export function numericValue(
  v: DescriptorValue | undefined,
  fallback: number,
  _context: string,
): number {
  if (!v) return fallback;
  switch (v.type) {
    case 'long':
    case 'doub':
    case 'UnFl':
      return typeof v.value === 'number' ? v.value : fallback;
    case 'UntF':
      return typeof v.value === 'number' ? v.value : fallback;
    default:
      return fallback;
  }
}

export function textValue(
  v: DescriptorValue | undefined,
  fallback: string,
  _context: string,
): string {
  if (!v) return fallback;
  if (v.type === 'TEXT') return String(v.value);
  return fallback;
}

export function stringValue(
  v: DescriptorValue | undefined,
  fallback: string,
  _context: string,
): string {
  if (!v) return fallback;
  if (v.type === 'enum' && typeof v.enumValue === 'string') return v.enumValue;
  return fallback;
}

export function boolValue(
  v: DescriptorValue | undefined,
  fallback: boolean,
  _context: string,
): boolean {
  if (!v) return fallback;
  if (v.type === 'bool') return Boolean(v.value);
  if (v.type === 'long') return (v.value as number) !== 0;
  return fallback;
}

/**
 * Parse a descriptor block starting at `reader.position`. Returns the value.
 */
export function readDescriptor(reader: ByteReader): DescriptorValue {
  return parseDescriptor(reader, 0);
}

/** Sanitize a decoded name for display (strip control chars, cap length). */
export function sanitizeName(name: string, maxLength = GRD_LIMITS.maxNameLength): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09) continue;
    out += ch;
    if (out.length >= maxLength) break;
  }
  return out;
}

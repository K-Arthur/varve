/**
 * ICNS icon container encoder (PNG-based representations, macOS 10.7+).
 *
 * Pure and deterministic: no DOM, no platform APIs, no shell tools. Each
 * representation is a PNG byte buffer wrapped in a typed chunk; the modern
 * (Retina-era) type set is supported so a single container covers 16px
 * through 1024px including @2x pairs. Chunks are ordered deterministically
 * by type. Legacy 24-bit (icns) chunks are intentionally not produced — the
 * PNG container is the current macOS format and keeps alpha.
 */

export interface IcnsEntry {
  /** ICNS chunk type (e.g. 'icp4', 'ic08', 'ic10'). */
  type: string;
  /** PNG-encoded image data for this representation. */
  png: Uint8Array;
}

export interface IcnsRepresentation {
  type: string;
  /** Nominal icon size in points. */
  size: number;
  /** Pixel dimensions (size * scale). */
  pixelSize: number;
  scale: 1 | 2;
  label: string;
}

/** The modern PNG-based representation set, ordered for deterministic output. */
export const ICNS_REPRESENTATIONS: readonly IcnsRepresentation[] = [
  { type: 'icp4', size: 16, pixelSize: 16, scale: 1, label: '16x16' },
  { type: 'icp5', size: 32, pixelSize: 32, scale: 1, label: '32x32' },
  { type: 'icp6', size: 64, pixelSize: 64, scale: 1, label: '64x64' },
  { type: 'ic07', size: 128, pixelSize: 128, scale: 1, label: '128x128' },
  { type: 'ic08', size: 256, pixelSize: 256, scale: 1, label: '256x256' },
  { type: 'ic09', size: 512, pixelSize: 512, scale: 1, label: '512x512' },
  { type: 'ic10', size: 1024, pixelSize: 1024, scale: 1, label: '1024x1024' },
  { type: 'ic11', size: 16, pixelSize: 32, scale: 2, label: '16x16@2x' },
  { type: 'ic12', size: 32, pixelSize: 64, scale: 2, label: '32x32@2x' },
  { type: 'ic13', size: 128, pixelSize: 256, scale: 2, label: '128x128@2x' },
  { type: 'ic14', size: 256, pixelSize: 512, scale: 2, label: '256x256@2x' },
  { type: 'ic15', size: 512, pixelSize: 1024, scale: 2, label: '512x512@2x' },
] as const;

const ICNS_SIGNATURE = 0x69636e73; // 'icns'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

function typeToCode(type: string): number {
  if (type.length !== 4) return 0;
  return (
    ((type.charCodeAt(0) & 0xff) << 24) |
    ((type.charCodeAt(1) & 0xff) << 16) |
    ((type.charCodeAt(2) & 0xff) << 8) |
    (type.charCodeAt(3) & 0xff)
  );
}

function codeToType(code: number): string {
  return String.fromCharCode(
    (code >>> 24) & 0xff,
    (code >>> 16) & 0xff,
    (code >>> 8) & 0xff,
    code & 0xff,
  );
}

export interface IcnsValidation {
  ok: boolean;
  warnings: string[];
  /** Representation types found in the container. */
  representations: string[];
}

/** Validate raw ICNS bytes structurally (container, chunk bounds, PNG data). */
export function validateIcns(bytes: Uint8Array): IcnsValidation {
  const warnings: string[] = [];
  const representations: string[] = [];
  if (bytes.length < 8) {
    return { ok: false, warnings: ['File too short for an ICNS header.'], representations };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  const totalLength = view.getUint32(4);
  if (signature !== ICNS_SIGNATURE) {
    return { ok: false, warnings: ['ICNS signature is missing.'], representations };
  }
  if (totalLength !== bytes.length) {
    warnings.push(`Header length (${totalLength}) does not match file size (${bytes.length}).`);
  }
  let cursor = 8;
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) {
      warnings.push('Truncated chunk header.');
      break;
    }
    const typeCode = view.getUint32(cursor);
    const chunkLength = view.getUint32(cursor + 4);
    if (chunkLength < 8 || cursor + chunkLength > bytes.length) {
      warnings.push(`Chunk ${codeToType(typeCode)} has invalid length ${chunkLength}.`);
      break;
    }
    const data = bytes.slice(cursor + 8, cursor + chunkLength);
    if (!isPng(data)) {
      warnings.push(`Chunk ${codeToType(typeCode)} is not PNG data.`);
    }
    representations.push(codeToType(typeCode));
    cursor += chunkLength;
  }
  return { ok: warnings.length === 0, warnings, representations };
}

export interface BuildIcnsResult {
  bytes: Uint8Array;
  /** Chunk types written, in container order. */
  types: string[];
  warnings: string[];
}

/**
 * Build an ICNS container from PNG entries.
 * - Entries are ordered by the canonical representation order (type code
 *   ascending for unknown types), producing deterministic output.
 * - Duplicate types are dropped (first wins).
 */
export function buildIcns(entries: IcnsEntry[]): BuildIcnsResult {
  const warnings: string[] = [];
  const order = new Map<string, number>();
  for (let index = 0; index < ICNS_REPRESENTATIONS.length; index += 1) {
    order.set(ICNS_REPRESENTATIONS[index]!.type, index);
  }

  const seen = new Map<string, IcnsEntry>();
  for (const entry of entries) {
    if (!isPng(entry.png)) {
      warnings.push(`Skipping chunk ${entry.type}: not a PNG.`);
      continue;
    }
    if (seen.has(entry.type)) {
      warnings.push(`Skipping duplicate chunk ${entry.type}.`);
      continue;
    }
    seen.set(entry.type, entry);
  }

  const sorted = [...seen.values()].sort((a, b) => {
    const ao = order.get(a.type);
    const bo = order.get(b.type);
    if (ao !== undefined && bo !== undefined) return ao - bo;
    if (ao !== undefined) return -1;
    if (bo !== undefined) return 1;
    return a.type < b.type ? -1 : 1;
  });

  if (sorted.length === 0) {
    return { bytes: new Uint8Array(0), types: [], warnings: ['No valid PNG entries provided.'] };
  }

  const totalLength = 8 + sorted.reduce((sum, entry) => sum + 8 + entry.png.length, 0);
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, ICNS_SIGNATURE);
  view.setUint32(4, totalLength);

  let cursor = 8;
  const types: string[] = [];
  for (const entry of sorted) {
    view.setUint32(cursor, typeToCode(entry.type));
    view.setUint32(cursor + 4, 8 + entry.png.length);
    bytes.set(entry.png, cursor + 8);
    cursor += 8 + entry.png.length;
    types.push(entry.type);
  }

  return { bytes, types, warnings };
}

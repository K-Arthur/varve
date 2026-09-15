/**
 * Palette file format parsers and exporters.
 *
 * Supports GIMP Palette (.gpl) text format. ASE/ACO binary formats deferred
 * to a dedicated binary parser module due to block structure complexity.
 *
 * Research basis: GIMP palette spec, Adobe Swatch Exchange (ASE) spec v1.0.
 */

export interface GplColorEntry {
  r: number;
  g: number;
  b: number;
  name?: string;
}

export interface GplPalette {
  name: string;
  columns: number;
  colors: GplColorEntry[];
}

/**
 * Parse a GIMP .gpl palette file (UTF-8 text).
 */
export function parseGplPalette(source: string): GplPalette {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (!lines[0]?.startsWith('GIMP Palette')) {
    throw new Error('Invalid GPL palette: missing "GIMP Palette" header');
  }

  let name = 'Untitled';
  let columns = 4;
  const colors: GplColorEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('Name:')) {
      name = line.slice(5).trim();
      continue;
    }
    if (line.startsWith('Columns:')) {
      columns = Number.parseInt(line.slice(8).trim(), 10) || 4;
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const r = Number.parseInt(parts[0] ?? '0', 10);
    const g = Number.parseInt(parts[1] ?? '0', 10);
    const b = Number.parseInt(parts[2] ?? '0', 10);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
    const namePart = parts.slice(3).join(' ').trim();
    colors.push({ r, g, b, ...(namePart ? { name: namePart } : {}) });
  }

  return { name, columns, colors };
}

/**
 * Export colors to GIMP .gpl palette format.
 */
export function exportGplPalette(name: string, colors: GplColorEntry[]): string {
  const lines = ['GIMP Palette', `Name: ${name}`, 'Columns: 4', '#'];
  for (const c of colors) {
    const r = Math.max(0, Math.min(255, Math.round(c.r)));
    const g = Math.max(0, Math.min(255, Math.round(c.g)));
    const b = Math.max(0, Math.min(255, Math.round(c.b)));
    const label = c.name ?? '';
    lines.push(`${r}\t${g}\t${b}\t${label}`);
  }
  return `${lines.join('\n')}\n`;
}

// ── ASE (Adobe Swatch Exchange) ──────────────────────────────────────────────

/** A single color entry parsed from an ASE file. */
export interface AseColorEntry {
  name?: string;
  r: number;
  g: number;
  b: number;
}

/** A complete ASE palette with optional named groups. */
export interface AsePalette {
  name: string;
  groups: { name: string; colors: AseColorEntry[] }[];
  colors: AseColorEntry[];
}

/**
 * Read a Pascal string (u16 BE length + UTF-16 BE chars) from a DataView.
 * Returns empty string if length is 0 or data is out of bounds.
 */
function readPascalString(view: DataView, offset: number): string {
  if (offset + 2 > view.byteLength) return '';
  const len = view.getUint16(offset, false);
  if (len === 0) return '';
  const charOffset = offset + 2;
  const byteLen = len * 2;
  if (charOffset + byteLen > view.byteLength) return '';
  const chars: number[] = [];
  for (let i = 0; i < byteLen; i += 2) {
    chars.push(view.getUint16(charOffset + i, false));
  }
  return String.fromCharCode(...chars);
}

/**
 * Write a Pascal string (u16 BE length + UTF-16 BE chars).
 */
function writePascalString(s: string): Uint8Array {
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

/**
 * Export colors to Adobe Swatch Exchange (.ase) binary format.
 *
 * Each color is written as an RGB color entry block.
 * The resulting buffer can be round-tripped through parseAsePalette().
 */
export function exportAsePalette(_name: string, entries: AseColorEntry[]): ArrayBuffer {
  const blockData: { type: number; data: Uint8Array }[] = [];

  for (const entry of entries) {
    const nameBytes = writePascalString(entry.name ?? '');
    const modeBytes = new Uint8Array([0x52, 0x47, 0x42, 0x20]); // "RGB "
    const values = new Uint8Array(16);
    const dv = new DataView(values.buffer);
    dv.setFloat32(0, Math.max(0, Math.min(1, entry.r / 255)), false);
    dv.setFloat32(4, Math.max(0, Math.min(1, entry.g / 255)), false);
    dv.setFloat32(8, Math.max(0, Math.min(1, entry.b / 255)), false);
    dv.setFloat32(12, 0, false);
    // 2-byte padding to ensure even block size
    const padding = new Uint8Array(2);

    const combined = new Uint8Array(nameBytes.length + 4 + 16 + 2);
    combined.set(nameBytes, 0);
    combined.set(modeBytes, nameBytes.length);
    combined.set(values, nameBytes.length + 4);
    combined.set(padding, nameBytes.length + 4 + 16);

    blockData.push({ type: 2, data: combined });
  }

  // Header: 10 bytes; each block: 6-byte header + data
  let totalLen = 10;
  for (const block of blockData) {
    totalLen += 6 + block.data.length;
  }
  // parseAsePalette requires at least 12 bytes
  if (totalLen < 12) totalLen = 12;

  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  const bufArray = new Uint8Array(buf);

  // Write header
  view.setUint8(0, 0x41); // A
  view.setUint8(1, 0x53); // S
  view.setUint8(2, 0x45); // E
  view.setUint8(3, 0x46); // F
  view.setUint16(4, 1, false); // version = 1
  view.setUint32(6, entries.length, false); // block count

  let offset = 10;
  for (const block of blockData) {
    const blockLen = 6 + block.data.length;
    view.setUint16(offset, block.type, false);
    view.setUint32(offset + 2, blockLen, false);
    offset += 6;
    bufArray.set(block.data, offset);
    offset += block.data.length;
  }

  return buf;
}

/**
 * Parse an Adobe Swatch Exchange (.ase) binary file.
 *
 * Supported color modes: RGB, CMYK, LAB, Gray.
 * Non-RGB modes are converted to RGB analytically.
 */
export function parseAsePalette(buffer: ArrayBuffer): AsePalette {
  const view = new DataView(buffer);

  if (view.byteLength < 12) {
    throw new Error('Invalid ASE: buffer too small');
  }

  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== 'ASEF') {
    throw new Error('Invalid ASE: missing ASEF magic');
  }

  const version = view.getUint16(4, false);
  if (version !== 1) {
    throw new Error(`Invalid ASE: unsupported version ${version}`);
  }

  const result: AsePalette = { name: '', groups: [], colors: [] };
  let offset = 10;
  let currentGroup: { name: string; colors: AseColorEntry[] } | null = null;

  while (offset + 6 <= view.byteLength) {
    const blockType = view.getUint16(offset, false);
    const blockLength = view.getUint32(offset + 2, false);
    offset += 6;

    if (blockLength < 6) break;
    const dataEnd = offset + (blockLength - 6);
    if (dataEnd > view.byteLength) break;

    if (blockType === 1) {
      // Group start
      const name = readPascalString(view, offset);
      currentGroup = { name, colors: [] };
      result.groups.push(currentGroup);
    } else if (blockType === 2) {
      // Color entry
      const name = readPascalString(view, offset);
      const nameLen = offset + 2 <= view.byteLength ? view.getUint16(offset, false) : 0;
      let colorOffset = offset + 2 + nameLen * 2;

      if (colorOffset + 20 > view.byteLength) {
        offset = dataEnd;
        continue;
      }

      const mode = String.fromCharCode(
        view.getUint8(colorOffset),
        view.getUint8(colorOffset + 1),
        view.getUint8(colorOffset + 2),
        view.getUint8(colorOffset + 3),
      );
      colorOffset += 4;

      let r = 0;
      let g = 0;
      let b = 0;

      if (mode === 'RGB ') {
        const rv = view.getFloat32(colorOffset, false);
        const gv = view.getFloat32(colorOffset + 4, false);
        const bv = view.getFloat32(colorOffset + 8, false);
        r = Math.max(0, Math.min(255, Math.round(rv * 255)));
        g = Math.max(0, Math.min(255, Math.round(gv * 255)));
        b = Math.max(0, Math.min(255, Math.round(bv * 255)));
      } else if (mode === 'CMYK') {
        const cv = view.getFloat32(colorOffset, false);
        const mv = view.getFloat32(colorOffset + 4, false);
        const yv = view.getFloat32(colorOffset + 8, false);
        const kv = view.getFloat32(colorOffset + 12, false);
        // Analytical CMYK → RGB
        const rr = 1 - Math.min(1, Math.max(0, cv)) - Math.min(1, Math.max(0, kv));
        const gg = 1 - Math.min(1, Math.max(0, mv)) - Math.min(1, Math.max(0, kv));
        const bb = 1 - Math.min(1, Math.max(0, yv)) - Math.min(1, Math.max(0, kv));
        r = Math.max(0, Math.min(255, Math.round(rr * 255)));
        g = Math.max(0, Math.min(255, Math.round(gg * 255)));
        b = Math.max(0, Math.min(255, Math.round(bb * 255)));
      } else if (mode === 'Gray') {
        const vv = view.getFloat32(colorOffset, false);
        r = Math.max(0, Math.min(255, Math.round(vv * 255)));
        g = r;
        b = r;
      } else if (mode === 'LAB ') {
        const lv = view.getFloat32(colorOffset, false);
        const av = view.getFloat32(colorOffset + 4, false);
        const bv = view.getFloat32(colorOffset + 8, false);
        // Approximate LAB → sRGB (D50 reference white)
        // This is a simplified conversion sufficient for palette display
        const fy = (lv + 16) / 116;
        const fx = av / 500 + fy;
        const fz = fy - bv / 200;
        const x = 0.9642 * (fx ** 3 > 0.008856 ? fx ** 3 : (fx - 16 / 116) / 7.787);
        const y = 1.0 * (fy ** 3 > 0.008856 ? fy ** 3 : (fy - 16 / 116) / 7.787);
        const z = 0.8249 * (fz ** 3 > 0.008856 ? fz ** 3 : (fz - 16 / 116) / 7.787);
        // XYZ → linear sRGB (D50→D65 adaptation + sRGB matrix approx)
        const rl = 3.1339 * x - 1.617 * y - 0.4906 * z;
        const gl = -0.9785 * x + 1.916 * y + 0.0334 * z;
        const bl = 0.072 * x - 0.229 * y + 1.4056 * z;
        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        r = Math.round(clamp(rl) * 255);
        g = Math.round(clamp(gl) * 255);
        b = Math.round(clamp(bl) * 255);
      }

      const entry: AseColorEntry = { r, g, b, ...(name ? { name } : {}) };
      if (currentGroup) {
        currentGroup.colors.push(entry);
      } else {
        result.colors.push(entry);
      }
    }

    offset = dataEnd;
  }

  return result;
}

/** Parsed swatch from Adobe Color (.aco) — ASCII name + RGB only. */
export interface AcoColorEntry {
  r: number;
  g: number;
  b: number;
  name?: string;
}

/**
 * Parse Adobe Color Swatch (.aco) binary format (version 1, RGB entries only).
 * Supports the common 2-byte version header + color entries.
 */
export function parseAcoPalette(buffer: ArrayBuffer): AcoColorEntry[] {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return [];

  const version = view.getUint16(0, false);
  if (version !== 1 && version !== 2) return [];

  const colors: AcoColorEntry[] = [];
  let offset = 2;

  while (offset + 10 <= view.byteLength) {
    try {
      const colorSpace = view.getUint16(offset, false);
      // Validate color space: 0=RGB, 1=HSB, 2=CMYK, 7=Lab, 8=Gray
      if (![0, 1, 2, 7, 8].includes(colorSpace)) {
        offset += 10;
        continue;
      }
      offset += 2;
      if (colorSpace === 0) {
        // RGB: 4 x int16 (0-65535)
        const rv = view.getUint16(offset, false);
        const gv = view.getUint16(offset + 2, false);
        const bv = view.getUint16(offset + 4, false);
        offset += 8; // skip 2 padding bytes
        colors.push({
          r: Math.round((rv / 65535) * 255),
          g: Math.round((gv / 65535) * 255),
          b: Math.round((bv / 65535) * 255),
        });
      } else {
        offset += 8;
      }

      // Version 2 has Pascal string name after each color
      if (version === 2 && offset + 2 <= view.byteLength) {
        const nameLen = view.getUint16(offset, false);
        offset += 2 + nameLen * 2;
      }
    } catch {
      break;
    }
  }

  return colors;
}

/**
 * Export RGB colors to Adobe Color (.aco) version 1 binary.
 */
export function exportAcoPalette(colors: AcoColorEntry[]): ArrayBuffer {
  const buf = new ArrayBuffer(2 + colors.length * 10);
  const view = new DataView(buf);
  view.setUint16(0, 1, false);
  let offset = 2;
  for (const c of colors) {
    view.setUint16(offset, 0, false); // RGB color space
    offset += 2;
    view.setUint16(offset, Math.round((c.r / 255) * 65535), false);
    view.setUint16(offset + 2, Math.round((c.g / 255) * 65535), false);
    view.setUint16(offset + 4, Math.round((c.b / 255) * 65535), false);
    view.setUint16(offset + 6, 0, false); // padding
    offset += 8;
  }
  return buf;
}

// ── ACT (Adobe Color Table) ────────────────────────────────────────────────

/** A color parsed from an ACT file. */
export interface ActColorEntry {
  r: number;
  g: number;
  b: number;
}

/** A complete ACT palette. */
export interface ActPalette {
  name: string;
  colors: ActColorEntry[];
  /** Transparent index (0-255) when declared, else undefined. */
  transparentIndex?: number;
}

export const ACT_HEADER_BYTES = 768;
export const ACT_MAX_COLORS = 256;

/**
 * Parse an Adobe Color Table (.act) file.
 *
 * Format: 256 RGB triples (768 bytes), then u16 BE color count at 768, u16 BE
 * transparent index at 772. Files with no color-count header declare all 256.
 *
 * Untrusted-input rules: the buffer length is checked before any read, the
 * declared color count is clamped to [1, 256], and values are validated
 * against the 768-byte minimum. No allocation is driven by file metadata.
 */
export function parseActPalette(buffer: ArrayBuffer, name = 'Untitled'): ActPalette {
  const view = new DataView(buffer);
  if (view.byteLength < ACT_HEADER_BYTES) {
    throw new Error(
      `Invalid ACT palette: expected at least ${ACT_HEADER_BYTES} bytes, got ${view.byteLength}`,
    );
  }
  let colorCount = ACT_MAX_COLORS;
  if (view.byteLength >= 770) {
    const declared = view.getUint16(768, false);
    if (declared >= 1 && declared <= ACT_MAX_COLORS) {
      colorCount = declared;
    }
  }
  let transparentIndex: number | undefined;
  if (view.byteLength >= 774) {
    const idx = view.getUint16(772, false);
    if (idx < colorCount) transparentIndex = idx;
  }
  const colors: ActColorEntry[] = [];
  for (let i = 0; i < colorCount; i += 1) {
    const r = view.getUint8(i * 3);
    const g = view.getUint8(i * 3 + 1);
    const b = view.getUint8(i * 3 + 2);
    colors.push({ r, g, b });
  }
  return { name, colors, transparentIndex };
}

/**
 * Export RGB colors to Adobe Color Table (.act) binary.
 */
export function exportActPalette(colors: ActColorEntry[]): ArrayBuffer {
  const count = Math.min(ACT_MAX_COLORS, Math.max(1, colors.length));
  const buf = new ArrayBuffer(774);
  const view = new DataView(buf);
  for (let i = 0; i < count; i += 1) {
    const c = colors[i]!;
    view.setUint8(i * 3, Math.max(0, Math.min(255, Math.round(c.r))));
    view.setUint8(i * 3 + 1, Math.max(0, Math.min(255, Math.round(c.g))));
    view.setUint8(i * 3 + 2, Math.max(0, Math.min(255, Math.round(c.b))));
  }
  view.setUint16(768, count, false);
  view.setUint16(770, 0, false);
  return buf;
}

export type PaletteFileFormat = 'gpl' | 'act' | 'ase' | 'aco' | 'unknown';

/** Route a palette file to the correct parser by extension. */
export function paletteFileFormat(fileName: string): PaletteFileFormat {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'gpl':
      return 'gpl';
    case 'act':
      return 'act';
    case 'ase':
      return 'ase';
    case 'aco':
      return 'aco';
    default:
      return 'unknown';
  }
}

/** Parse a palette file (text or binary) into a uniform color list. */
export function parsePaletteFile(
  fileName: string,
  data: ArrayBuffer | string,
): { colors: [number, number, number][]; format: PaletteFileFormat; name: string } {
  const format = paletteFileFormat(fileName);
  switch (format) {
    case 'gpl': {
      const parsed = parseGplPalette(
        typeof data === 'string' ? data : new TextDecoder().decode(data),
      );
      return {
        name: parsed.name,
        format,
        colors: parsed.colors.map((c) => [c.r, c.g, c.b] as [number, number, number]),
      };
    }
    case 'act': {
      if (typeof data === 'string') {
        throw new Error('ACT palette requires binary data');
      }
      const parsed = parseActPalette(data, fileName);
      return { name: parsed.name, format, colors: parsed.colors.map((c) => [c.r, c.g, c.b]) };
    }
    case 'ase': {
      if (typeof data === 'string') {
        throw new Error('ASE palette requires binary data');
      }
      const parsed = parseAsePalette(data);
      const colors = [...parsed.colors, ...parsed.groups.flatMap((g) => g.colors)];
      return { name: parsed.name, format, colors: colors.map((c) => [c.r, c.g, c.b]) };
    }
    case 'aco': {
      if (typeof data === 'string') {
        throw new Error('ACO palette requires binary data');
      }
      const parsed = parseAcoPalette(data);
      return { name: fileName, format, colors: parsed.map((c) => [c.r, c.g, c.b]) };
    }
    default:
      throw new Error(`Unsupported palette format: ${fileName}`);
  }
}

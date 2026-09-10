/**
 * Photoshop `.grd` gradient preset file parser.
 *
 * Two families are supported:
 *
 * 1. Modern descriptor-based files (Photoshop CS6+; signature "8BGR"). The
 *    file is an 8BIM resource block wrapping a `GrdL` descriptor list of
 *    gradient objects. Layout (all multi-byte big-endian):
 *
 *      "8BGR" + version(u32) + "8BIM" + "GrdL" + pascal-string + size(u32)
 *      + 8 reserved bytes
 *      + "GrdL" + "VlLs" + count(i32)
 *      + count × gradient descriptor
 *
 *    Each gradient descriptor is an `Objc` whose `Grad` property holds the
 *    gradient object (`Nm  ` name, `Clrs` color stops, `Trns` opacity stops,
 *    optional `Mode`/`Smoothness`/noise fields). Color stops are `Objc`
 *    entries with `Lctn`/`Mdpn` longs and a `Clr ` color (`RGBC`, `HSBC`,
 *    `CMYC`, or `Grsc`). Opacity stops carry `Opct` as an `UntF` percent
 *    (0-100).
 *
 *    Reference: hi104/psd-grd (MIT) and the grdconverter project, both
 *    clean-room implementations that parse real Photoshop files; the format
 *    is also described in the Adobe Photoshop File Formats Specification
 *    (descriptor format, PSD spec section 21).
 *
 * 2. Legacy fixed-layout files (signature "Grad", version 1/2). Structure per
 *    the classic "Gradient Set" documentation. The legacy layout is
 *    implemented best-effort from the documented structure and validated
 *    against our own generated fixture; real-world legacy files are rare and
 *    unverified (see docs).
 *
 * Security: the parser only ever reads through the bounded `ByteReader`,
 * validates every count against remaining bytes, never executes embedded
 * data, and returns structured warnings separate from fatal errors. Unknown
 * gradient entries are skipped individually so a partially corrupt
 * multi-gradient file still imports its valid presets.
 */

import {
  asList,
  asObjc,
  ByteReader,
  boolValue,
  type DescriptorValue,
  GRD_LIMITS,
  GrdError,
  numericValue,
  readDescriptor,
  sanitizeName,
  stringValue,
  textValue,
} from './descriptor';

/** Color models understood by the modern descriptor parser. */
export type DescriptorColorModel = 'RGBC' | 'HSBC' | 'CMYC' | 'Grsc' | 'unknown';

export interface ParsedColorStop {
  /** Position 0-1 (normalized from the 0-4096 Photoshop scale). */
  position: number;
  /** Midpoint bias 0-1 (Photoshop 0-100 normalized). */
  midpoint: number;
  /** Best-effort sRGB conversion of the stop color. */
  color: readonly [number, number, number, number];
  /** Original color model in the file. */
  colorModel: DescriptorColorModel;
  /** Raw components as stored, for diagnostics. */
  rawComponents: readonly number[];
}

export interface ParsedOpacityStop {
  position: number;
  midpoint: number;
  /** 0-1 opacity. */
  opacity: number;
}

export interface ParsedGradient {
  /** Sanitized display name (may be empty). */
  name: string;
  colorStops: ParsedColorStop[];
  opacityStops: ParsedOpacityStop[];
  /** 0-1 smoothness, when present. */
  smoothness?: number;
  /** True when this is a Photoshop noise gradient (read-only in Strata). */
  isNoise: boolean;
  /** File-format version the gradient came from. */
  sourceVersion: 'descriptor' | 'legacy';
  /** Original raw name before sanitization (diagnostics). */
  originalName: string;
  warnings: string[];
}

export interface ParseGrdResult {
  gradients: ParsedGradient[];
  /** Non-fatal, structured warnings for the whole file. */
  warnings: string[];
}

export function detectGrdFamily(data: Uint8Array): 'descriptor' | 'legacy' | null {
  if (data.length < 4) return null;
  const sig = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
  if (sig === '8BGR') return 'descriptor';
  if (sig === 'Grad') return 'legacy';
  return null;
}

// ── Modern descriptor format ─────────────────────────────────────────────────

export function findDescriptorAnchor(reader: ByteReader): number {
  const scanEnd = Math.min(reader.length - 8, GRD_LIMITS.maxAnchorScan);
  for (let i = 0; i <= scanEnd; i++) {
    reader.seek(i);
    if (
      reader.readAscii(4, 'anchor.sig') === 'GrdL' &&
      reader.readAscii(4, 'anchor.type') === 'VlLs'
    ) {
      return i;
    }
  }
  throw new GrdError('unsupported-format', 'Could not locate the "GrdL" descriptor anchor');
}

function parseColorModelColor(stopObj: ReturnType<typeof asObjc>): {
  colorModel: DescriptorColorModel;
  rgb: [number, number, number, number];
  raw: number[];
} {
  const clr = stopObj.props['Clr '];
  if (!clr) return { colorModel: 'unknown', rgb: [0, 0, 0, 255], raw: [] };
  const colorObj = asObjc(clr, 'color stop "Clr "');
  const p = colorObj.props;
  const readComp = (key: string, fallback = 0) => numericValue(p[key], fallback, `color.${key}`);

  switch (colorObj.typename) {
    case 'RGBC': {
      const r = readComp('Rd  ');
      const g = readComp('Grn ');
      const b = readComp('Bl  ');
      return {
        colorModel: 'RGBC',
        rgb: [clampByte(r), clampByte(g), clampByte(b), 255],
        raw: [r, g, b],
      };
    }
    case 'HSBC': {
      const h = readComp('H   ');
      const s = readComp('Strt');
      const v = readComp('Brgh');
      const [r, g, b] = hsbToRgb(h / 360, s / 100, v / 100);
      return { colorModel: 'HSBC', rgb: [r, g, b, 255], raw: [h, s, v] };
    }
    case 'CMYC': {
      const c = readComp('Cyn ') / 100;
      const m = readComp('Mgnt') / 100;
      const y = (readComp('Yel ') || readComp('Yllw')) / 100;
      const k = readComp('Blck') / 100;
      const r = 255 * (1 - c) * (1 - k);
      const g = 255 * (1 - m) * (1 - k);
      const b = 255 * (1 - y) * (1 - k);
      return {
        colorModel: 'CMYC',
        rgb: [clampByte(r), clampByte(g), clampByte(b), 255],
        raw: [c * 100, m * 100, y * 100, k * 100],
      };
    }
    case 'Grsc': {
      const gray = readComp('Gry ') / 100;
      const v = clampByte(gray * 255);
      return { colorModel: 'Grsc', rgb: [v, v, v, 255], raw: [gray * 100] };
    }
    default:
      return { colorModel: 'unknown', rgb: [0, 0, 0, 255], raw: [] };
  }
}

function parseDescriptorColorStop(
  item: DescriptorValue,
  index: number,
  warnings: string[],
): ParsedColorStop | null {
  const obj = asObjc(item, `color stop ${index}`);
  const p = obj.props;
  const lctn = numericValue(p.Lctn, 0, `color stop ${index} Lctn`);
  const mdpn = numericValue(p.Mdpn, 50, `color stop ${index} Mdpn`);
  const { colorModel, rgb, raw } = parseColorModelColor(obj);
  if (colorModel === 'unknown') {
    warnings.push(
      `Color stop ${index + 1} uses an unsupported color model and was approximated to black`,
    );
  }
  return {
    position: lctn / 4096,
    midpoint: mdpn / 100,
    color: rgb,
    colorModel,
    rawComponents: raw,
  };
}

function parseDescriptorOpacityStop(item: DescriptorValue, index: number): ParsedOpacityStop {
  const obj = asObjc(item, `opacity stop ${index}`);
  const p = obj.props;
  const lctn = numericValue(p.Lctn, 0, `opacity stop ${index} Lctn`);
  const mdpn = numericValue(p.Mdpn, 50, `opacity stop ${index} Mdpn`);
  const opct = numericValue(p.Opct, 100, `opacity stop ${index} Opct`);
  return { position: lctn / 4096, midpoint: mdpn / 100, opacity: clamp01(opct / 100) };
}

function parseDescriptorGradient(
  item: DescriptorValue,
  index: number,
  fileWarnings: string[],
): ParsedGradient {
  const warnings: string[] = [];
  const topObj = asObjc(item, `gradient ${index}`);
  const gradObj = asObjc(topObj.props.Grad, `gradient ${index} Grad`);

  const rawName = textValue(gradObj.props['Nm  '], `Gradient ${index + 1}`, 'gradient name');
  const name = sanitizeName(rawName);

  const clrs = asList(gradObj.props.Clrs, `gradient ${index} Clrs`);
  const colorStops: ParsedColorStop[] = [];
  clrs.items.forEach((stopItem, i) => {
    const stop = parseDescriptorColorStop(stopItem, i, warnings);
    if (stop) colorStops.push(stop);
  });
  colorStops.sort((a, b) => a.position - b.position);

  const opacityStops: ParsedOpacityStop[] = [];
  const trns = gradObj.props.Trns;
  if (trns) {
    const trnsList = asList(trns, `gradient ${index} Trns`);
    trnsList.items.forEach((stopItem, i) => {
      opacityStops.push(parseDescriptorOpacityStop(stopItem, i));
    });
    opacityStops.sort((a, b) => a.position - b.position);
  }

  const smoothnessRaw = numericValue(gradObj.props.Smoothness, 0, 'smoothness');
  const mode = stringValue(gradObj.props.Mode, '', 'mode');
  const isNoise = boolValue(gradObj.props.Noise, false, 'noise') || /noise/i.test(mode);

  if (isNoise) {
    warnings.push(
      `"${name || `Gradient ${index + 1}`}" is a Photoshop noise gradient and is imported as read-only`,
    );
    fileWarnings.push(`Noise gradient "${name || `Gradient ${index + 1}`}" imported as read-only`);
  }

  return {
    name,
    colorStops,
    opacityStops,
    ...(Number.isFinite(smoothnessRaw) ? { smoothness: clamp01(smoothnessRaw / 4096) } : {}),
    isNoise,
    sourceVersion: 'descriptor',
    originalName: rawName,
    warnings,
  };
}

function parseDescriptorFile(data: Uint8Array): ParseGrdResult {
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const reader = new ByteReader(buffer);
  const warnings: string[] = [];

  const sig = reader.readAscii(4, 'signature');
  if (sig !== '8BGR') throw new GrdError('invalid-signature', 'Expected "8BGR" signature');
  const version = reader.readUint32('version');
  if (version < 3) {
    throw new GrdError('invalid-version', `Unsupported .grd version: ${version}`);
  }

  const anchor = findDescriptorAnchor(reader);
  reader.seek(anchor);
  const key = reader.readAscii(4, 'anchor key');
  const listType = reader.readAscii(4, 'anchor type');
  if (key !== 'GrdL' || listType !== 'VlLs') {
    throw new GrdError('unsupported-format', 'The descriptor anchor is not a "GrdL" list');
  }
  const count = reader.readInt32('gradient count');
  if (count < 0 || count > GRD_LIMITS.maxGradients) {
    throw new GrdError('invalid-count', `Unreasonable gradient count: ${count}`);
  }

  const gradients: ParsedGradient[] = [];
  for (let i = 0; i < count; i++) {
    const item = readDescriptor(reader);
    try {
      gradients.push(parseDescriptorGradient(item, i, warnings));
    } catch (err) {
      if (
        err instanceof GrdError &&
        (err.code === 'truncated' || err.code === 'excessive-resource')
      ) {
        throw err;
      }
      warnings.push(
        `Skipped gradient ${i + 1}: ${err instanceof Error ? err.message : 'parse error'}`,
      );
    }
  }

  if (gradients.length === 0) {
    throw new GrdError('no-usable-gradients', 'No usable gradients found in the .grd file');
  }

  return { gradients, warnings };
}

function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  let hh = h - Math.floor(h);
  if (hh < 0) hh += 1;
  if (s <= 0) {
    const g = clampByte(v * 255);
    return [g, g, g];
  }
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const sel = i % 6;
  let r = v;
  let g = p;
  let b = p;
  if (sel === 0) {
    r = v;
    g = t;
    b = p;
  } else if (sel === 1) {
    r = q;
    g = v;
    b = p;
  } else if (sel === 2) {
    r = p;
    g = v;
    b = t;
  } else if (sel === 3) {
    r = p;
    g = q;
    b = v;
  } else if (sel === 4) {
    r = t;
    g = p;
    b = v;
  }
  return [clampByte(r * 255), clampByte(g * 255), clampByte(b * 255)];
}

function clampByte(v: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ── Legacy fixed-layout format ───────────────────────────────────────────────

function parseLegacyGradient(
  reader: ByteReader,
  index: number,
  version: 1 | 2,
  warnings: string[],
): ParsedGradient {
  const gradWarnings: string[] = [];
  const nameLen = reader.readUint16(`gradient ${index} name length`);
  if (nameLen > GRD_LIMITS.maxNameLength) {
    throw new GrdError('corrupt-name', `Unreasonable legacy name length: ${nameLen}`);
  }
  const rawName = reader.readUtf16Be(nameLen, `gradient ${index} name`);
  const name = sanitizeName(rawName);

  const colorStopCount = reader.readUint16(`gradient ${index} color stop count`);
  if (colorStopCount > GRD_LIMITS.maxColorStops) {
    throw new GrdError('invalid-count', `Too many color stops: ${colorStopCount}`);
  }
  const colorStops: ParsedColorStop[] = [];
  for (let i = 0; i < colorStopCount; i++) {
    reader.readUint16(`gradient ${index} stop ${i} reserved`);
    const colorType = reader.readUint16(`gradient ${index} stop ${i} color type`);
    const opacity = reader.readUint16(`gradient ${index} stop ${i} opacity`);
    const location = reader.readUint32(`gradient ${index} stop ${i} location`);
    const midpoint = reader.readUint16(`gradient ${index} stop ${i} midpoint`);
    let rgb: [number, number, number, number];
    let model: DescriptorColorModel = 'unknown';
    if (colorType === 0) {
      const r = reader.readUint16(`gradient ${index} stop ${i} r`);
      const g = reader.readUint16(`gradient ${index} stop ${i} g`);
      const b = reader.readUint16(`gradient ${index} stop ${i} b`);
      const modelId = reader.readUint16(`gradient ${index} stop ${i} model`);
      rgb = [clampByte(r / 256), clampByte(g / 256), clampByte(b / 256), 255];
      model =
        modelId === 0
          ? 'RGBC'
          : modelId === 1
            ? 'HSBC'
            : modelId === 2
              ? 'CMYC'
              : modelId === 3
                ? 'Grsc'
                : 'unknown';
    } else {
      rgb = [0, 0, 0, 255];
      gradWarnings.push(
        `Color stop ${i + 1} uses unsupported legacy color type ${colorType} and was approximated to black`,
      );
    }
    colorStops.push({
      position: clamp01(location / 4096),
      midpoint: clamp01(midpoint / 100),
      color: rgb,
      colorModel: model,
      rawComponents: [],
    });
    void opacity;
  }

  const opacityStopCount = reader.readUint16(`gradient ${index} opacity stop count`);
  if (opacityStopCount > GRD_LIMITS.maxOpacityStops) {
    throw new GrdError('invalid-count', `Too many opacity stops: ${opacityStopCount}`);
  }
  const opacityStops: ParsedOpacityStop[] = [];
  for (let i = 0; i < opacityStopCount; i++) {
    reader.readUint16(`gradient ${index} opacity stop ${i} reserved`);
    reader.readUint16(`gradient ${index} opacity stop ${i} type`);
    const opacity = reader.readUint16(`gradient ${index} opacity stop ${i} opacity`);
    const location = reader.readUint32(`gradient ${index} opacity stop ${i} location`);
    const midpoint = reader.readUint16(`gradient ${index} opacity stop ${i} midpoint`);
    opacityStops.push({
      position: clamp01(location / 4096),
      midpoint: clamp01(midpoint / 100),
      opacity: clamp01(opacity / 4096),
    });
  }

  // Trailing gradient-record fields (version 2): gradientLength, mode,
  // randomSeed, showTransparency, vector colors, smoothness, noise flag.
  const gradientLength = reader.readUint16(`gradient ${index} length`);
  reader.readUint8(`gradient ${index} mode`);
  reader.skip(4, `gradient ${index} random seed`);
  reader.skip(1, `gradient ${index} show transparency`);
  reader.skip(128, `gradient ${index} vector colors`);
  let smoothness = 0;
  if (version === 2) {
    smoothness = reader.readUint32(`gradient ${index} smoothness`);
  }
  if (gradientLength > 2) {
    reader.skip(2, `gradient ${index} extra padding`);
  }
  const noise = reader.readUint8(`gradient ${index} noise`);
  if (noise !== 0) {
    gradWarnings.push(
      `"${name || `Gradient ${index + 1}`}" is a legacy noise gradient and is imported as read-only`,
    );
    warnings.push(
      `Legacy noise gradient "${name || `Gradient ${index + 1}`}" imported as read-only`,
    );
  }

  return {
    name,
    colorStops,
    opacityStops,
    ...(gradientLength >= 4 && Number.isFinite(smoothness)
      ? { smoothness: clamp01(smoothness / 4096) }
      : {}),
    isNoise: noise !== 0,
    sourceVersion: 'legacy',
    originalName: rawName,
    warnings: gradWarnings,
  };
}

function parseLegacyFile(data: Uint8Array): ParseGrdResult {
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const reader = new ByteReader(buffer);
  const warnings: string[] = [];

  const sig = reader.readAscii(4, 'signature');
  if (sig !== 'Grad') throw new GrdError('invalid-signature', 'Expected "Grad" signature');
  const version = reader.readUint16('version');
  if (version < 1 || version > 2) {
    throw new GrdError('invalid-version', `Unsupported legacy .grd version: ${version}`);
  }
  const count = reader.readUint16('gradient count');
  if (count === 0) throw new GrdError('no-usable-gradients', 'The file contains no gradients');
  if (count > GRD_LIMITS.maxGradients) {
    throw new GrdError('invalid-count', `Unreasonable gradient count: ${count}`);
  }

  const gradients: ParsedGradient[] = [];
  for (let i = 0; i < count; i++) {
    try {
      gradients.push(parseLegacyGradient(reader, i, version as 1 | 2, warnings));
    } catch (err) {
      if (
        err instanceof GrdError &&
        (err.code === 'truncated' || err.code === 'excessive-resource')
      ) {
        throw err;
      }
      warnings.push(
        `Skipped gradient ${i + 1}: ${err instanceof Error ? err.message : 'parse error'}`,
      );
    }
  }

  if (gradients.length === 0) {
    throw new GrdError('no-usable-gradients', 'No usable gradients found in the .grd file');
  }
  return { gradients, warnings };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Parse a `.grd` file (bounded). Returns structured gradients + warnings. */
export function parsePhotoshopGrd(data: Uint8Array): ParseGrdResult {
  if (data.byteLength === 0) {
    throw new GrdError('unsupported-format', 'The file is empty');
  }
  if (data.byteLength > GRD_LIMITS.maxFileSize) {
    throw new GrdError(
      'excessive-resource',
      `File exceeds the ${GRD_LIMITS.maxFileSize}-byte safety limit`,
    );
  }
  const family = detectGrdFamily(data);
  if (family === 'descriptor') return parseDescriptorFile(data);
  if (family === 'legacy') return parseLegacyFile(data);
  throw new GrdError(
    'invalid-signature',
    'This file does not appear to be a Photoshop gradient preset',
  );
}

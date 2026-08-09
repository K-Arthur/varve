/**
 * Deterministic ICC matrix/TRC profile authoring for the supported RGB
 * working spaces.
 *
 * Export needs to embed a real ICC profile to produce genuinely tagged
 * output ("Display P3 PNG" must mean P3-encoded pixels + a P3 profile, not
 * a relabel). Shipping profile bytes per space duplicates data and makes
 * byte-level determinism hard; instead this module authors standard
 * matrix/TRC profiles on demand from the same analytical primaries/transfer
 * tables the conversion engine uses (ICC.1:2010, profile class 'mntr',
 * PCS XYZ, D50 illuminant).
 *
 * Supported TRC encodings:
 *   - sRGB / rec2020 → parametric curve type 4 (piecewise)
 *   - gamma22 / gamma18 / prophoto → parametric curve type 0 (pure gamma)
 *     (ProPhoto uses a gamma 1.8 approximation — the canonical ROMM curve
 *     requires a LUT profile, which is out of scope for deterministic
 *     authoring; documented in the capability matrix)
 *
 * The written profile is fully parseable by standard ICC consumers and
 * round-trips through Varve's own extraction (see rasterColor tests).
 */

import {
  linearRgbPrimariesToXyzD50,
  type RgbPrimariesName,
  type TransferFunctionName,
} from '@varve/shared';

/** ICC s15Fixed16 conversion. */
function s15f16(v: number): number {
  return Math.round(v * 65536);
}

function writeUint32(out: Uint8Array, offset: number, value: number): void {
  new DataView(out.buffer).setUint32(offset, value >>> 0);
}

function writeS15F16(out: Uint8Array, offset: number, value: number): void {
  writeUint32(out, offset, s15f16(value) >>> 0);
}

function writeAscii(out: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    out[offset + i] = text.charCodeAt(i) & 0xff;
  }
}

/** Human-readable profile description for a working space. */
export function profileDescriptionFor(primaries: RgbPrimariesName): string {
  switch (primaries) {
    case 'srgb':
      return 'Varve sRGB IEC61966-2.1';
    case 'display-p3':
      return 'Varve Display P3';
    case 'adobe-rgb':
      return 'Varve Adobe RGB (1998)';
    case 'pro-photo':
      return 'Varve ProPhoto RGB';
    case 'rec2020':
      return 'Varve Rec.2020';
    case 'unknown':
      return 'Varve RGB';
  }
}

/** Default transfer for a primaries family (used when none is supplied). */
export function defaultTransferFor(primaries: RgbPrimariesName): TransferFunctionName {
  switch (primaries) {
    case 'srgb':
      return 'srgb';
    case 'display-p3':
      // CSS Color 4 defines display-p3 with the sRGB transfer function;
      // the authored profile must use the same curve the conversion uses
      // so exported pixels and embedded profile stay self-consistent.
      return 'srgb';
    case 'adobe-rgb':
      return 'gamma22';
    case 'pro-photo':
      return 'prophoto';
    case 'rec2020':
      return 'rec2020';
    case 'unknown':
      return 'srgb';
  }
}

/**
 * Parametric curve bytes (type 'para'). `params` order matches the ICC
 * function type: function 0 → [g]; function 4 → [g, a, b, c, d, e, f].
 */
function paraCurve(functionType: 0 | 4, params: number[]): { type: Uint8Array; size: number } {
  const body = new Uint8Array(12 + params.length * 4);
  writeAscii(body, 0, 'para');
  // reserved u32
  new DataView(body.buffer).setUint16(4, functionType);
  for (let i = 0; i < params.length; i += 1) {
    writeS15F16(body, 8 + i * 4, params[i]!);
  }
  return { type: body, size: body.length };
}

/** Transfer → ICC parametric curve (function 0 or 4). */
function transferCurve(transfer: TransferFunctionName): { type: Uint8Array; size: number } {
  switch (transfer) {
    case 'srgb':
      return paraCurve(4, [2.4, 1 / 1.055, 0.055 / 1.055, 0, 0.0031308, 1 / 12.92, 0]);
    case 'rec2020': {
      // Rec.2020 OETF: (aX)^0.45 + c for X >= d, eX for X < d.
      const alpha = 1.09929682680944;
      const beta = 0.018053968510807;
      const a = alpha ** (1 / 0.45);
      return paraCurve(4, [0.45, a, 0, -(alpha - 1), beta, 4.5, 0]);
    }
    case 'gamma22':
      return paraCurve(0, [2.2]);
    case 'gamma18':
    case 'prophoto':
      return paraCurve(0, [1.8]);
    case 'linear':
      return paraCurve(0, [1]);
    case 'pq':
    case 'hlg':
    case 'unknown':
      throw new Error(`transfer ${transfer} cannot be authored as a parametric curve`);
  }
}

/**
 * Author a minimal, valid ICC matrix/TRC profile for an RGB working space.
 * Deterministic: same inputs → identical bytes.
 *
 * @throws when the transfer cannot be represented (pq/hlg/unknown).
 */
export function buildMatrixProfile(
  primaries: RgbPrimariesName,
  transfer?: TransferFunctionName,
  description?: string,
): Uint8Array {
  const trc = transfer ?? defaultTransferFor(primaries);
  if (primaries === 'unknown') {
    throw new Error('cannot author an ICC profile for unknown primaries');
  }
  const label = description ?? profileDescriptionFor(primaries);

  // Tag data (built first to know offsets):
  // 1. desc  (type 'desc')
  // 2. cprt  (type 'text')
  // 3. wtpt  (type 'XYZ ')
  // 4-6. rXYZ/gXYZ/bXYZ
  // 7-9. rTRC/gTRC/bTRC
  const descBody = new Uint8Array(16 + label.length + 1);
  writeAscii(descBody, 0, 'desc');
  writeUint32(descBody, 8, label.length);
  writeAscii(descBody, 12, label);
  descBody[12 + label.length] = 0;

  const cprtBody = new Uint8Array(4 + 12);
  writeAscii(cprtBody, 0, 'text');
  writeAscii(cprtBody, 8, 'Varve color');

  const xyzBody = new Uint8Array(20);
  writeAscii(xyzBody, 0, 'XYZ ');
  writeS15F16(xyzBody, 8, 0.96422); // D50 X
  writeS15F16(xyzBody, 12, 1.0); // D50 Y
  writeS15F16(xyzBody, 16, 0.82521); // D50 Z

  const primariesXyz = (channel: 'red' | 'green' | 'blue'): readonly [number, number, number] => {
    const rgb: [number, number, number] =
      channel === 'red' ? [1, 0, 0] : channel === 'green' ? [0, 1, 0] : [0, 0, 1];
    const xyz = linearRgbPrimariesToXyzD50(primaries, rgb);
    if (!xyz) throw new Error(`no XYZ for primaries ${primaries}`);
    return xyz;
  };

  const xyzTag = (xyz: readonly [number, number, number]): Uint8Array => {
    const body = new Uint8Array(20);
    writeAscii(body, 0, 'XYZ ');
    writeS15F16(body, 8, xyz[0]);
    writeS15F16(body, 12, xyz[1]);
    writeS15F16(body, 16, xyz[2]);
    return body;
  };

  const trcCurve = transferCurve(trc);
  const trcTag = (): Uint8Array => trcCurve.type.slice();

  const tags: Array<{ sig: string; body: Uint8Array }> = [
    { sig: 'desc', body: descBody },
    { sig: 'cprt', body: cprtBody },
    { sig: 'wtpt', body: xyzBody.slice() },
    { sig: 'rXYZ', body: xyzTag(primariesXyz('red')) },
    { sig: 'gXYZ', body: xyzTag(primariesXyz('green')) },
    { sig: 'bXYZ', body: xyzTag(primariesXyz('blue')) },
    { sig: 'rTRC', body: trcTag() },
    { sig: 'gTRC', body: trcTag() },
    { sig: 'bTRC', body: trcTag() },
  ];

  const headerSize = 128;
  const tagTableSize = 4 + tags.length * 12;
  let dataOffset = headerSize + tagTableSize;
  const tagEntries: Array<{ sig: string; offset: number; size: number }> = [];
  for (const tag of tags) {
    tagEntries.push({ sig: tag.sig, offset: dataOffset, size: tag.body.length });
    dataOffset += tag.body.length;
  }

  const profile = new Uint8Array(dataOffset);
  const view = new DataView(profile.buffer);
  view.setUint32(0, profile.length);
  writeAscii(profile, 4, 'appl');
  profile[8] = 4; // major version 4
  profile[9] = 0x30; // minor 3, bugfix 0
  writeAscii(profile, 12, 'mntr'); // display class
  writeAscii(profile, 16, 'RGB ');
  writeAscii(profile, 20, 'XYZ ');
  // date/time: fixed epoch (year 2000-01-01 00:00:00)
  view.setUint16(24, 2000);
  view.setUint16(26, 1);
  view.setUint16(28, 1);
  profile[30] = 0;
  profile[31] = 0;
  profile[32] = 0;
  writeAscii(profile, 36, 'acsp');
  writeAscii(profile, 40, 'APPL');
  writeUint32(profile, 44, 0); // flags
  writeAscii(profile, 48, 'NONE');
  view.setUint32(52, 0); // device model
  view.setBigUint64(56, 0n); // device attributes
  view.setUint32(64, 0); // rendering intent: perceptual
  // PCS illuminant D50
  writeS15F16(profile, 68, 0.96422);
  writeS15F16(profile, 72, 1.0);
  writeS15F16(profile, 76, 0.82521);
  writeAscii(profile, 80, 'none');

  view.setUint32(128, tags.length);
  for (let i = 0; i < tags.length; i += 1) {
    const entry = tagEntries[i]!;
    const offset = 132 + i * 12;
    writeAscii(profile, offset, entry.sig);
    view.setUint32(offset + 4, entry.offset);
    view.setUint32(offset + 8, entry.size);
  }
  for (const entry of tagEntries) {
    const tag = tags.find((t) => t.sig === entry.sig)!;
    profile.set(tag.body, entry.offset);
  }

  return profile;
}

/** Parsed ICC header fields (engine-side display/preflight). */
export interface RasterIccHeaderInfo {
  size: number;
  profileClass?: string;
  colorSpace?: string;
  version?: string;
  renderingIntent?: number;
  description?: string;
}

/** Engine-side minimal ICC header parse (mirrors the import parser). */
export function parseIccHeader(bytes: Uint8Array): RasterIccHeaderInfo {
  if (bytes.length < 128) return { size: bytes.length };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const className = String.fromCharCode(
    bytes[12] ?? 0x20,
    bytes[13] ?? 0x20,
    bytes[14] ?? 0x20,
    bytes[15] ?? 0x20,
  );
  const colorSpaceName = String.fromCharCode(
    bytes[16] ?? 0x20,
    bytes[17] ?? 0x20,
    bytes[18] ?? 0x20,
    bytes[19] ?? 0x20,
  );
  const isPrintable = (sig: string): boolean => {
    for (let i = 0; i < sig.length; i += 1) {
      const code = sig.charCodeAt(i);
      if (code < 0x20 || code > 0x7e) return false;
    }
    return true;
  };
  const major = bytes[8] ?? 0;
  const minor = ((bytes[9] ?? 0) >> 4) & 0x0f;
  const bugfix = (bytes[9] ?? 0) & 0x0f;
  const intent = view.getUint32(64);
  let description: string | undefined;
  if (bytes.length >= 132) {
    // Walk the tag table for the 'desc' tag (robust for any profile).
    const tagCount = view.getUint32(128);
    const maxTags = Math.min(tagCount, 64);
    for (let i = 0; i < maxTags; i += 1) {
      const entryOffset = 132 + i * 12;
      if (entryOffset + 12 > bytes.length) break;
      const sig = String.fromCharCode(
        bytes[entryOffset] ?? 0,
        bytes[entryOffset + 1] ?? 0,
        bytes[entryOffset + 2] ?? 0,
        bytes[entryOffset + 3] ?? 0,
      );
      if (sig !== 'desc') continue;
      const tagOffset = view.getUint32(entryOffset + 4);
      const tagSize = view.getUint32(entryOffset + 8);
      if (tagOffset + 12 + 4 > bytes.length) break;
      // desc: 4-byte type + 4-byte reserved + 4-byte count + text + NUL.
      const count = view.getUint32(tagOffset + 8);
      if (count > 0 && count <= 255 && tagOffset + 12 + count <= bytes.length) {
        let printable = true;
        let label = '';
        for (let k = 0; k < count; k += 1) {
          const c = bytes[tagOffset + 12 + k]!;
          if (c === 0 || c > 0x7e) {
            printable = false;
            break;
          }
          label += String.fromCharCode(c);
        }
        if (printable && label.trim().length > 0) description = label.trim();
      }
      void tagSize;
      break;
    }
  }
  return {
    size: view.getUint32(0),
    ...(isPrintable(className) ? { profileClass: className } : {}),
    ...(isPrintable(colorSpaceName) ? { colorSpace: colorSpaceName } : {}),
    ...(major > 0 ? { version: `${major}.${minor}.${bugfix}` } : {}),
    ...(Number.isInteger(intent) && intent <= 3 ? { renderingIntent: intent } : {}),
    ...(description ? { description } : {}),
  };
}

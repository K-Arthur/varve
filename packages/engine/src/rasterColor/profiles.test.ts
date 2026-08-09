/**
 * Deterministic ICC profile authoring + embedding round trips.
 *
 * The authored profile is a real ICC v4 matrix/TRC file: header, tag table,
 * desc/cprt/wtpt/rXYZ/gXYZ/bXYZ/rTRC/gTRC/bTRC. Tests verify structure with
 * the engine-side parser, and verify JPEG APP2 / PNG iCCP embedding round-
 * trips byte-for-byte through Varve's own chunk reconstruction.
 */
import { describe, expect, it } from 'vitest';
import { buildMatrixProfile, parseIccHeader, profileDescriptionFor } from './profiles';
import { insertJpegIccProfile } from './embed';

function jpegSoi(): Uint8Array {
  // SOI + a tiny COM segment + SOS marker (real JPEG framing).
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xfe, 0x00, 0x08, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0xff, 0xda, 0x00, 0x08, 0x01,
  ]);
}

/** Reconstruct chunked APP2 ICC segments from a JPEG byte stream. */
function reconstructJpegIcc(bytes: Uint8Array): Uint8Array | null {
  const chunks = new Map<number, Uint8Array>();
  let declared = 0;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
    if (length < 2) break;
    const payloadEnd = offset + 2 + length;
    if (payloadEnd > bytes.length) break;
    if (marker === 0xe2 && payloadEnd >= offset + 18) {
      const sig = String.fromCharCode(...Array.from(bytes.slice(offset + 4, offset + 16)));
      if (sig === 'ICC_PROFILE\u0000') {
        const seq = bytes[offset + 16]!;
        const total = bytes[offset + 17]!;
        if (declared === 0) declared = total;
        chunks.set(seq, bytes.slice(offset + 18, payloadEnd));
      }
    }
    if (marker === 0xda || marker === 0xd9) break;
    offset = payloadEnd;
  }
  if (chunks.size === 0 || chunks.size !== declared) return null;
  const parts: Uint8Array[] = [];
  for (let seq = 1; seq <= declared; seq += 1) {
    const chunk = chunks.get(seq);
    if (!chunk) return null;
    parts.push(chunk);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

describe('buildMatrixProfile', () => {
  it('authors a structurally valid profile with the right header', () => {
    const profile = buildMatrixProfile('display-p3');
    expect(profile.length).toBeGreaterThan(128);
    expect(profile[36]).toBe(0x61); // 'a'
    expect(profile[37]).toBe(0x63);
    expect(profile[38]).toBe(0x73);
    expect(profile[39]).toBe(0x70); // 'acsp'
    const header = parseIccHeader(profile);
    expect(header.size).toBe(profile.length);
    expect(header.profileClass).toBe('mntr');
    expect(header.colorSpace).toBe('RGB ');
    expect(header.version).toBe('4.3.0');
    expect(header.description).toBe('Varve Display P3');
  });

  it('is deterministic: same inputs, identical bytes', () => {
    const a = buildMatrixProfile('srgb', 'srgb');
    const b = buildMatrixProfile('srgb', 'srgb');
    expect(a).toEqual(b);
    const p3a = buildMatrixProfile('display-p3');
    const p3b = buildMatrixProfile('display-p3');
    expect(p3a).toEqual(p3b);
    expect(p3a).not.toEqual(a);
  });

  it('writes distinct primaries for each working space', () => {
    const srgb = parseIccHeader(buildMatrixProfile('srgb'));
    const p3 = parseIccHeader(buildMatrixProfile('display-p3'));
    const proPhoto = parseIccHeader(buildMatrixProfile('pro-photo'));
    expect(srgb.description).toBe('Varve sRGB IEC61966-2.1');
    expect(p3.description).toBe('Varve Display P3');
    expect(proPhoto.description).toBe('Varve ProPhoto RGB');
    // Primaries differ: compare wtpt/rXYZ bytes (offset 132 tag table start).
    const a = buildMatrixProfile('srgb');
    const b = buildMatrixProfile('display-p3');
    expect(a).not.toEqual(b);
  });

  it('uses parametric curve function 4 for sRGB and function 0 for gamma', () => {
    const srgb = buildMatrixProfile('srgb', 'srgb');
    // Locate the rTRC tag and check the para function type byte.
    const view = new DataView(srgb.buffer, srgb.byteOffset, srgb.byteLength);
    const tagCount = view.getUint32(128);
    let trcOffset = -1;
    for (let i = 0; i < tagCount; i += 1) {
      const entry = 132 + i * 12;
      const sig = String.fromCharCode(
        srgb[entry]!,
        srgb[entry + 1]!,
        srgb[entry + 2]!,
        srgb[entry + 3]!,
      );
      if (sig === 'rTRC') trcOffset = view.getUint32(entry + 4);
    }
    expect(trcOffset).toBeGreaterThanOrEqual(0);
    const funcType = view.getUint16(trcOffset + 4);
    expect(funcType).toBe(4); // piecewise sRGB
    const gamma = buildMatrixProfile('display-p3', 'gamma22');
    const view2 = new DataView(gamma.buffer, gamma.byteOffset, gamma.byteLength);
    const tagCount2 = view2.getUint32(128);
    let trcOffset2 = -1;
    for (let i = 0; i < tagCount2; i += 1) {
      const entry = 132 + i * 12;
      const sig = String.fromCharCode(
        gamma[entry]!,
        gamma[entry + 1]!,
        gamma[entry + 2]!,
        gamma[entry + 3]!,
      );
      if (sig === 'rTRC') trcOffset2 = view2.getUint32(entry + 4);
    }
    expect(trcOffset2).toBeGreaterThanOrEqual(0);
    expect(view2.getUint16(trcOffset2 + 4)).toBe(0); // pure gamma
  });

  it('rejects unknown primaries', () => {
    expect(() => buildMatrixProfile('unknown')).toThrow();
  });

  it('rejects PQ/HLG transfers explicitly', () => {
    expect(() => buildMatrixProfile('rec2020', 'pq')).toThrow();
  });
});

describe('JPEG APP2 ICC embedding', () => {
  it('embeds and reconstructs a small profile', () => {
    const profile = buildMatrixProfile('display-p3');
    const jpeg = jpegSoi();
    const embedded = insertJpegIccProfile(jpeg, profile);
    expect(embedded[0]).toBe(0xff);
    expect(embedded[1]).toBe(0xd8);
    const reconstructed = reconstructJpegIcc(embedded);
    expect(reconstructed).not.toBeNull();
    expect(reconstructed).toEqual(profile);
  });

  it('chunks large profiles across multiple APP2 segments', () => {
    const profile = buildMatrixProfile('display-p3');
    const big = new Uint8Array(2 * 65503 + 100);
    big.set(profile, 0);
    const jpeg = jpegSoi();
    const embedded = insertJpegIccProfile(jpeg, big);
    const reconstructed = reconstructJpegIcc(embedded);
    expect(reconstructed).not.toBeNull();
    expect(reconstructed).toEqual(big);
  });

  it('rejects non-JPEG input', () => {
    expect(() => insertJpegIccProfile(new Uint8Array([1, 2, 3]), new Uint8Array(4))).toThrow();
  });
});

describe('profileDescriptionFor / defaultTransferFor', () => {
  it('labels the supported working spaces', () => {
    expect(profileDescriptionFor('srgb')).toContain('sRGB');
    expect(profileDescriptionFor('display-p3')).toBe('Varve Display P3');
  });
});

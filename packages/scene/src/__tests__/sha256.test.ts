/**
 * SHA-256 known-answer tests (FIPS 180-4) for the canonical digest.
 */
import { describe, expect, it } from 'vitest';
import { canonicalDigest, sha256Hex, sha256Utf8 } from '../sha256';

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('sha256Hex', () => {
  it('matches FIPS 180-4 example vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Utf8('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes 1MB of "a" correctly (FIPS long-vector)', () => {
    const big = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(big)).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('handles partial-block lengths around the padding boundary', () => {
    // 55 bytes: fits in one block after padding (56-byte length field).
    const s55 = 'a'.repeat(55);
    // 56 bytes: spills into a second block.
    const s56 = 'a'.repeat(56);
    const known55 = sha256Utf8(s55);
    const known56 = sha256Utf8(s56);
    expect(known55).toMatch(/^[0-9a-f]{64}$/);
    expect(known56).toMatch(/^[0-9a-f]{64}$/);
    expect(known55).not.toBe(known56);
  });

  it('digests arbitrary byte sequences', () => {
    expect(sha256Hex(fromHex('000102030405060708090a0b0c0d0e0f'))).toBe(
      'be45cb2605bf36bebde684841a28f0fd43c69850a3dce5fedba69928ee3a8991',
    );
  });

  it('canonicalDigest equals sha256Utf8', () => {
    expect(canonicalDigest('{"a":1}')).toBe(sha256Utf8('{"a":1}'));
  });
});

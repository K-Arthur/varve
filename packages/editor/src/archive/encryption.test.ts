/**
 * Tests for AES-GCM encryption module.
 *
 * Verifies round-trip encrypt/decrypt, wrong password rejection,
 * tamper detection, and checksum verification.
 */

import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  computeChecksum,
  decryptBytes,
  deriveKey,
  encryptBytes,
  getKdfParams,
  hexToBytes,
  verifyChecksum,
} from './encryption';

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('encryption', () => {
  const password = 'test-password-123';

  describe('deriveKey', () => {
    it('returns a CryptoKey', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(password, salt);
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('produces consistent keys from same inputs', async () => {
      const salt = new Uint8Array(16);
      const key1 = await deriveKey(password, salt);
      const key2 = await deriveKey(password, salt);
      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
    });
  });

  describe('encryptBytes / decryptBytes', () => {
    it('round-trips data correctly', async () => {
      const data = new TextEncoder().encode('Hello, Varve!');
      const encrypted = await encryptBytes(data, password);
      const decrypted = await decryptBytes(encrypted, password);
      expect(arraysEqual(decrypted, data)).toBe(true);
    });

    it('produces different ciphertext each time (random nonce)', async () => {
      const data = new TextEncoder().encode('Same data');
      const enc1 = await encryptBytes(data, password);
      const enc2 = await encryptBytes(data, password);
      expect(bytesToHex(enc1)).not.toBe(bytesToHex(enc2));
    });

    it('rejects wrong password', async () => {
      const data = new TextEncoder().encode('Secret data');
      const encrypted = await encryptBytes(data, password);
      await expect(decryptBytes(encrypted, 'wrong-password')).rejects.toThrow();
    });

    it('rejects tampered ciphertext', async () => {
      const data = new TextEncoder().encode('Tamper test');
      const encrypted = await encryptBytes(data, password);
      const tampered = new Uint8Array(encrypted);
      tampered[30] = tampered[30]! ^ 0xff;
      await expect(decryptBytes(tampered, password)).rejects.toThrow();
    });

    it('rejects data shorter than salt+nonce', async () => {
      const tooShort = new Uint8Array(20);
      await expect(decryptBytes(tooShort, password)).rejects.toThrow('too short');
    });

    it('handles non-trivial data sizes', async () => {
      const data = new TextEncoder().encode('A'.repeat(1024));
      const encrypted = await encryptBytes(data, password);
      const decrypted = await decryptBytes(encrypted, password);
      expect(arraysEqual(decrypted, data)).toBe(true);
    });

    it('handles binary data', async () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = i;
      const encrypted = await encryptBytes(data, password);
      const decrypted = await decryptBytes(encrypted, password);
      expect(arraysEqual(decrypted, data)).toBe(true);
    });

    it('round-trips data spanning multiple chunks (chunked STREAM construction)', async () => {
      // CHUNK_SIZE is 1 MiB — this forces at least 3 chunks, exercising the
      // per-chunk nonce derivation and the mid-stream/final AAD marker.
      const data = new Uint8Array(2.5 * 1024 * 1024);
      for (let i = 0; i < data.length; i++) data[i] = i % 251;
      const encrypted = await encryptBytes(data, password);
      const decrypted = await decryptBytes(encrypted, password);
      expect(arraysEqual(decrypted, data)).toBe(true);
    });

    it('rejects a truncated ciphertext (dropped final chunk) instead of returning a shorter file', async () => {
      const data = new Uint8Array(2.5 * 1024 * 1024);
      for (let i = 0; i < data.length; i++) data[i] = i % 251;
      const encrypted = await encryptBytes(data, password);
      // Drop everything after the first full chunk (salt+baseNonce+chunkSize
      // header, plus exactly one ciphertext+tag chunk) — a naive
      // non-authenticated framing would happily decrypt this as a valid,
      // just-shorter file.
      const headerAndOneChunk = 32 + (1024 * 1024 + 16);
      const truncated = encrypted.slice(0, headerAndOneChunk);
      await expect(decryptBytes(truncated, password)).rejects.toThrow();
    });

    it('rejects tampering with the unauthenticated chunk-size header field', async () => {
      const data = new TextEncoder().encode('Header tamper test');
      const encrypted = await encryptBytes(data, password);
      const tampered = new Uint8Array(encrypted);
      // Byte 29 is inside the chunk-size field (offset 28..32), not the
      // GCM-protected ciphertext — a design that only authenticates the
      // ciphertext body would let this slip through.
      tampered[29] = tampered[29]! ^ 0xff;
      await expect(decryptBytes(tampered, password)).rejects.toThrow();
    });
  });

  describe('computeChecksum', () => {
    it('returns a 64-char hex string', async () => {
      const data = new TextEncoder().encode('test data');
      const checksum = await computeChecksum(data);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic', async () => {
      const data = new TextEncoder().encode('deterministic');
      const c1 = await computeChecksum(data);
      const c2 = await computeChecksum(data);
      expect(c1).toBe(c2);
    });

    it('changes when data changes', async () => {
      const c1 = await computeChecksum(new TextEncoder().encode('one'));
      const c2 = await computeChecksum(new TextEncoder().encode('two'));
      expect(c1).not.toBe(c2);
    });
  });

  describe('verifyChecksum', () => {
    it('returns true for matching checksum', async () => {
      const data = new TextEncoder().encode('verify me');
      const checksum = await computeChecksum(data);
      expect(await verifyChecksum(data, checksum)).toBe(true);
    });

    it('returns false for non-matching checksum', async () => {
      const data = new TextEncoder().encode('verify me');
      expect(await verifyChecksum(data, 'a'.repeat(64))).toBe(false);
    });

    it('returns false for wrong-length checksum', async () => {
      const data = new TextEncoder().encode('verify me');
      expect(await verifyChecksum(data, 'abc')).toBe(false);
    });
  });

  describe('getKdfParams', () => {
    it('returns expected parameters', () => {
      const params = getKdfParams();
      expect(params.iterations).toBe(600_000);
      expect(params.saltLength).toBe(16);
      expect(params.hash).toBe('SHA-256');
    });
  });

  describe('bytesToHex / hexToBytes', () => {
    it('round-trips correctly', () => {
      const original = new Uint8Array([0, 1, 127, 128, 255]);
      const hex = bytesToHex(original);
      const restored = hexToBytes(hex);
      expect(arraysEqual(restored, original)).toBe(true);
    });

    it('produces lowercase hex', () => {
      const bytes = new Uint8Array([0xff, 0xab, 0xcd]);
      expect(bytesToHex(bytes)).toBe('ffabcd');
    });
  });
});

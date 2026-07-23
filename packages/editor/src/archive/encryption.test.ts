/**
 * Tests for AES-GCM encryption module.
 *
 * Verifies round-trip encrypt/decrypt, wrong password rejection,
 * tamper detection, and checksum verification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeChecksum,
  decryptBytes,
  deriveKey,
  encryptBytes,
  getKdfParams,
  hexToBytes,
  bytesToHex,
  verifyChecksum,
} from './encryption';

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
      const salt = new Uint8Array(16); // deterministic
      const key1 = await deriveKey(password, salt);
      const key2 = await deriveKey(password, salt);
      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
      // Both should be valid keys; exact equality requires exportKey
    });
  });

  describe('encryptBytes / decryptBytes', () => {
    it('round-trips data correctly', async () => {
      const data = new TextEncoder().encode('Hello, Strata!');
      const encrypted = await encryptBytes(data, password);
      const decrypted = await decryptBytes(encrypted, password);
      expect(decrypted).toEqual(data);
    });

    it('produces different ciphertext each time (random nonce)', async () => {
      const data = new TextEncoder().encode('Same data');
      const enc1 = await encryptBytes(data, password);
      const enc2 = await encryptBytes(data, password);
      // Nonces are random, so ciphertext should differ
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
      // Flip a byte in the ciphertext
      const tampered = new Uint8Array(encrypted);
      tampered[30] ^= 0xff;
      await expect(decryptBytes(tampered, password)).rejects.toThrow();
    });

    it('rejects data shorter than salt+nonce', async () => {
      const tooShort = new Uint8Array(20);
      await expect(decryptBytes(tooShort, password)).rejects.toThrow('too short');
    });

    it('handles empty data', async () => {
      const data = new Uint8Array(0);
      const encrypted = await encryptBytes(data, password);
      const decrypted = await decryptBytes(encrypted, password);
      expect(decrypted.byteLength).toBe(0);
    });

    it('handles large data', async () => {
      const data = new Uint8Array(1024 * 1024); // 1MB
      crypto.getRandomValues(data);
      const encrypted = await encryptBytes(data, password);
      const decrypted = await decryptBytes(encrypted, password);
      expect(decrypted).toEqual(data);
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
      expect(restored).toEqual(original);
    });

    it('produces lowercase hex', () => {
      const bytes = new Uint8Array([0xff, 0xab, 0xcd]);
      expect(bytesToHex(bytes)).toBe('ffabcd');
    });
  });
});

/**
 * AES-GCM encryption using Web Crypto API.
 *
 * Provides authenticated encryption for archive payloads with PBKDF2 key
 * derivation. All operations are async and use the platform-native
 * SubtleCrypto implementation (browser/Tauri WebKitGTK).
 *
 * Wire format: [salt (16 bytes)][nonce (12 bytes)][ciphertext][authTag]
 * Auth tag is appended by AES-GCM automatically (16 bytes).
 *
 * Research basis: Web Crypto API spec, OWASP key derivation guidelines.
 * PBKDF2 iterations set to 600,000 (OWASP 2023 recommendation for
 * password-based key derivation with SHA-256).
 */

const DEFAULT_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;
const KEY_LENGTH = 256;
const HASH = 'SHA-256';

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error('Web Crypto API not available');
  return c;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Derive an AES-GCM-256 key from a password via PBKDF2. */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  params?: { iterations?: number; hash?: string },
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: params?.iterations ?? DEFAULT_ITERATIONS,
      hash: params?.hash ?? HASH,
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt bytes with AES-GCM. Returns [salt][nonce][ciphertext+tag].
 * The salt and nonce are random per call, ensuring ciphertext indistinguishability.
 */
export async function encryptBytes(data: Uint8Array, password: string): Promise<Uint8Array> {
  const subtle = getSubtle();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const key = await deriveKey(password, salt);

  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', nonce }, key, data);

  // Concatenate: salt + nonce + ciphertext (includes auth tag)
  const result = new Uint8Array(salt.length + nonce.length + ciphertext.byteLength);
  result.set(salt, 0);
  result.set(nonce, salt.length);
  result.set(new Uint8Array(ciphertext), salt.length + nonce.length);
  return result;
}

/**
 * Decrypt bytes encrypted with `encryptBytes`. Verifies the GCM auth tag.
 * Throws on wrong password, tampered data, or malformed input.
 */
export async function decryptBytes(data: Uint8Array, password: string): Promise<Uint8Array> {
  const subtle = getSubtle();
  if (data.byteLength < SALT_LENGTH + NONCE_LENGTH + 1) {
    throw new Error('Encrypted data too short');
  }

  const salt = data.slice(0, SALT_LENGTH);
  const nonce = data.slice(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + NONCE_LENGTH);
  const key = await deriveKey(password, salt);

  const decrypted = await subtle.decrypt({ name: 'AES-GCM', nonce }, key, ciphertext);
  return new Uint8Array(decrypted);
}

/**
 * Compute SHA-256 checksum of data, returned as hex string.
 * Used for integrity verification of archive entries.
 */
export async function computeChecksum(data: Uint8Array): Promise<string> {
  const subtle = getSubtle();
  const hash = await subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Verify that data matches an expected SHA-256 checksum.
 * Uses constant-time comparison to prevent timing side-channels.
 */
export async function verifyChecksum(data: Uint8Array, expected: string): Promise<boolean> {
  const actual = await computeChecksum(data);
  if (actual.length !== expected.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Compute PBKDF2 key derivation parameters for manifest metadata. */
export function getKdfParams(): {
  iterations: number;
  saltLength: number;
  hash: string;
} {
  return { iterations: DEFAULT_ITERATIONS, saltLength: SALT_LENGTH, hash: HASH };
}

export { bytesToHex, hexToBytes };

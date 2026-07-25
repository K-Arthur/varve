/**
 * AES-GCM encryption using Web Crypto API.
 *
 * Provides authenticated encryption for archive payloads with PBKDF2 key
 * derivation. All operations are async and use the platform-native
 * SubtleCrypto implementation (browser/Tauri WebKitGTK).
 *
 * Chunked wire format (STREAM construction — Hoang/Reyhanitabar/Rogaway/
 * Vizár; the same design libsodium's crypto_secretstream and Rust's
 * aead::stream use, not a custom protocol):
 *   [salt (16 bytes)][baseNonce (12 bytes)][chunkSize (4 bytes, u32 BE)]
 *   [chunk0 ciphertext+tag][chunk1 ciphertext+tag]...[chunkN ciphertext+tag]
 * Each chunk's nonce is `baseNonce` with its last 4 bytes XORed with the
 * big-endian chunk index, so every AES-GCM invocation gets a unique nonce
 * from a single random base value. Each chunk is authenticated with a
 * 1-byte associated-data marker (0x00 mid-stream, 0x01 on the final chunk)
 * so a truncated ciphertext (dropped trailing chunks) fails authentication
 * instead of decrypting as a shorter-but-valid file.
 *
 * This bounds how much plaintext any single AES-GCM invocation processes
 * (relevant for very large archives — GCM's security margin degrades with
 * per-invocation plaintext size) and is a prerequisite for true end-to-end
 * streaming if the surrounding archive pipeline is later changed to
 * process the ZIP incrementally rather than building it fully in memory
 * first.
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
const TAG_LENGTH = 16;
/** Plaintext bytes per chunk (1 MiB). */
const CHUNK_SIZE = 1024 * 1024;
const HEADER_LENGTH = SALT_LENGTH + NONCE_LENGTH + 4;

// `as BufferSource` casts below work around TS 5.7+'s generic `Uint8Array<TArrayBuffer>`:
// SubtleCrypto's DOM types require the ArrayBuffer-specific view, but a plain
// `Uint8Array` parameter widens to `Uint8Array<ArrayBufferLike>` (which also
// covers SharedArrayBuffer) and no longer satisfies that structurally. Every
// value here is always constructed over a real ArrayBuffer, so the cast is safe.
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
      salt: salt as BufferSource,
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
 * Derive the per-chunk nonce: `base` with its last 4 bytes XORed with the
 * big-endian chunk index. Guarantees a unique nonce per chunk from one
 * random base nonce, for as many chunks as fit in a 32-bit counter.
 */
function chunkNonce(base: Uint8Array, index: number): Uint8Array {
  const nonce = base.slice();
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const offset = nonce.length - 4;
  const current = view.getUint32(offset, false);
  view.setUint32(offset, (current ^ index) >>> 0, false);
  return nonce;
}

/**
 * Associated data for one chunk: the declared chunk size (so tampering with
 * that unauthenticated header field is caught — every chunk's tag would
 * stop matching the AAD reconstructed from the tampered value) plus a
 * 1-byte marker distinguishing the final chunk from mid-stream ones.
 */
function chunkAad(chunkSize: number, isFinal: boolean): Uint8Array {
  const aad = new Uint8Array(5);
  new DataView(aad.buffer).setUint32(0, chunkSize, false);
  aad[4] = isFinal ? 1 : 0;
  return aad;
}

/**
 * Encrypt bytes with chunked AES-GCM (STREAM construction — see module
 * docs). The salt and base nonce are random per call, ensuring ciphertext
 * indistinguishability.
 */
export async function encryptBytes(data: Uint8Array, password: string): Promise<Uint8Array> {
  const subtle = getSubtle();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const baseNonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const key = await deriveKey(password, salt);

  const totalChunks = Math.max(1, Math.ceil(data.length / CHUNK_SIZE));
  const cipherChunks: Uint8Array[] = [];
  let cipherTotal = 0;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, data.length);
    const isFinal = i === totalChunks - 1;
    const ciphertext = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: chunkNonce(baseNonce, i) as BufferSource,
        additionalData: chunkAad(CHUNK_SIZE, isFinal) as BufferSource,
      },
      key,
      data.subarray(start, end) as BufferSource,
    );
    const chunkBytes = new Uint8Array(ciphertext);
    cipherChunks.push(chunkBytes);
    cipherTotal += chunkBytes.length;
  }

  const result = new Uint8Array(HEADER_LENGTH + cipherTotal);
  result.set(salt, 0);
  result.set(baseNonce, SALT_LENGTH);
  new DataView(result.buffer).setUint32(SALT_LENGTH + NONCE_LENGTH, CHUNK_SIZE, false);
  let offset = HEADER_LENGTH;
  for (const chunk of cipherChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Decrypt bytes encrypted with `encryptBytes`. Verifies every chunk's GCM
 * auth tag, including the final-chunk marker that detects truncation.
 * Throws on wrong password, tampered data, truncated input, or malformed input.
 */
export async function decryptBytes(data: Uint8Array, password: string): Promise<Uint8Array> {
  const subtle = getSubtle();
  if (data.byteLength < HEADER_LENGTH + TAG_LENGTH) {
    throw new Error('Encrypted data too short');
  }

  const salt = data.slice(0, SALT_LENGTH);
  const baseNonce = data.slice(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH);
  const chunkSize = new DataView(
    data.buffer,
    data.byteOffset + SALT_LENGTH + NONCE_LENGTH,
    4,
  ).getUint32(0, false);
  if (chunkSize <= 0) {
    throw new Error('Malformed encrypted data: invalid chunk size');
  }
  const key = await deriveKey(password, salt);

  const body = data.subarray(HEADER_LENGTH);
  const cipherChunkSize = chunkSize + TAG_LENGTH;
  const totalChunks = Math.max(1, Math.ceil(body.length / cipherChunkSize));

  const plainChunks: Uint8Array[] = [];
  let plainTotal = 0;
  let offset = 0;
  for (let i = 0; i < totalChunks; i++) {
    const isFinal = i === totalChunks - 1;
    const end = Math.min(offset + cipherChunkSize, body.length);
    const chunkCiphertext = body.subarray(offset, end);
    let plain: ArrayBuffer;
    try {
      plain = await subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: chunkNonce(baseNonce, i) as BufferSource,
          additionalData: chunkAad(chunkSize, isFinal) as BufferSource,
        },
        key,
        chunkCiphertext as BufferSource,
      );
    } catch {
      throw new Error('Decryption failed — wrong password or corrupted data');
    }
    const plainBytes = new Uint8Array(plain);
    plainChunks.push(plainBytes);
    plainTotal += plainBytes.length;
    offset = end;
  }

  const result = new Uint8Array(plainTotal);
  let writeOffset = 0;
  for (const chunk of plainChunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  return result;
}

/**
 * Compute SHA-256 checksum of data, returned as hex string.
 * Used for integrity verification of archive entries.
 */
export async function computeChecksum(data: Uint8Array): Promise<string> {
  const subtle = getSubtle();
  const hash = await subtle.digest('SHA-256', data as BufferSource);
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

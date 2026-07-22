import type { BackupStore } from './storage';
import type { BackupManifest, BackupVerificationStatus } from './types';

export interface VerificationResult {
  valid: boolean;
  status: BackupVerificationStatus;
  computedChecksum: string;
  reportedChecksum: string;
  assetErrors: string[];
  sizeMismatch: boolean;
}

export async function verifyBackup(
  store: BackupStore,
  backupId: string,
  manifest: BackupManifest,
): Promise<VerificationResult> {
  const errors: string[] = [];
  let valid = true;
  let documentChecksum = '';
  let sizeMismatch = false;

  const documentJson = await store.readBackupDocument(backupId);
  if (!documentJson) {
    errors.push('Document is missing');
    return {
      valid: false,
      status: 'corrupted',
      computedChecksum: '',
      reportedChecksum: manifest.documentChecksum,
      assetErrors: errors,
      sizeMismatch: false,
    };
  }

  documentChecksum = await computeChecksum(documentJson);
  if (documentChecksum !== manifest.documentChecksum) {
    errors.push('Document checksum mismatch');
    valid = false;
  }

  const actualSize = new TextEncoder().encode(documentJson).length;
  if (actualSize !== manifest.documentSize) {
    sizeMismatch = true;
    if (Math.abs(actualSize - manifest.documentSize) > 1024) {
      errors.push(`Document size mismatch: expected ${manifest.documentSize}, got ${actualSize}`);
      valid = false;
    }
  }

  const assetErrors: string[] = [];
  const status: BackupVerificationStatus = valid ? 'verified' : 'corrupted';
  return {
    valid,
    status,
    computedChecksum: documentChecksum,
    reportedChecksum: manifest.documentChecksum,
    assetErrors,
    sizeMismatch,
  };
}

export async function verifyBackupsBatch(
  store: BackupStore,
  manifests: Array<{ id: string; manifest: BackupManifest }>,
): Promise<Map<string, VerificationResult>> {
  const results = new Map<string, VerificationResult>();
  for (const { id, manifest } of manifests) {
    const result = await verifyBackup(store, id, manifest);
    results.set(id, result);
  }
  return results;
}

/**
 * SHA-256 checksum of `data`, prefixed `sha256-`.
 *
 * Uses Web Crypto (`crypto.subtle.digest`) when available and secure
 * (browser window, secure context); otherwise falls back to a pure-JS
 * SHA-256 so the function never throws in non-secure contexts.
 *
 * Replaces the old FNV-1a 32-bit hash for stronger integrity detection.
 */
export async function computeChecksum(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await sha256(bytes);
  return `sha256-${toHex(digest)}`;
}

/** Keep the old name pointing at the real implementation for compat. */
export const computeSha256 = computeChecksum;

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const buf = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
      return new Uint8Array(buf);
    } catch {
      // fall through to pure-JS
    }
  }
  return sha256Sync(bytes);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Sync(data: Uint8Array): Uint8Array {
  let H0 = 0x6a09e667 | 0;
  let H1 = 0xbb67ae85 | 0;
  let H2 = 0x3c6ef372 | 0;
  let H3 = 0xa54ff53a | 0;
  let H4 = 0x510e527f | 0;
  let H5 = 0x9b05688c | 0;
  let H6 = 0x1f83d9ab | 0;
  let H7 = 0x5be0cd19 | 0;

  const msg = new Uint8Array(data.length + 9);
  msg.set(data, 0);
  msg[data.length] = 0x80;
  const bitLen = data.length * 8;
  const total = Math.ceil(((data.length + 9) / 64) * 64);
  const view = new DataView(msg.buffer);
  view.setUint32(total - 4, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(total - 8, bitLen >>> 0, false);

  const w = new Array(64);
  for (let chunk = 0; chunk < total; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = H0,
      b = H1,
      c = H2,
      d = H3,
      e = H4,
      f = H5,
      g = H6,
      h = H7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H0 = (H0 + a) | 0;
    H1 = (H1 + b) | 0;
    H2 = (H2 + c) | 0;
    H3 = (H3 + d) | 0;
    H4 = (H4 + e) | 0;
    H5 = (H5 + f) | 0;
    H6 = (H6 + g) | 0;
    H7 = (H7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, H0, false);
  ov.setUint32(4, H1, false);
  ov.setUint32(8, H2, false);
  ov.setUint32(12, H3, false);
  ov.setUint32(16, H4, false);
  ov.setUint32(20, H5, false);
  ov.setUint32(24, H6, false);
  ov.setUint32(28, H7, false);
  return out;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

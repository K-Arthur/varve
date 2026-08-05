/**
 * Collision-resistant persistent identity (ADR-0025/0026).
 *
 * Legacy ids are sequential per document (`n<counter>`, `s<counter>`,
 * `col-<counter>`, ...) — two independently edited copies of the same
 * document allocate identical ids. New ids keep the readable prefix and
 * counter and append a random component:
 *
 *   `n<counter>_<16 hex chars>`   (64 bits of randomness per allocation)
 *
 * Uniqueness within a document comes from the counter; uniqueness across
 * branches/merges comes from the random component. Legacy ids remain
 * readable forever; only new allocations use the minted format.
 *
 * The RNG is injectable so tests are deterministic:
 * `nextNodeId(doc, () => 'abc...')` and `setDefaultIdRng(...)`.
 */
import type { NodeId } from './types';

export const MINTED_ID_SEPARATOR = '_';

export const HEX_CHARS = '0123456789abcdef';

/** Matches the legacy sequential node id format, e.g. `n12`. */
export const LEGACY_NUMERIC_ID_RE = /^([a-z-]+)(\d+)$/;

/** Matches the minted collision-resistant id format, e.g. `n12_3fa9c2...`. */
export const MINTED_ID_RE = /^([a-z]+)(\d+)_([0-9a-f]+)$/;

/** A random-source function returning lowercase hex characters. */
export type IdRng = () => string;

/** Cryptographically strong random hex (8 bytes = 16 chars). */
export function randomHex(bytes: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const out = new Uint8Array(bytes);
    crypto.getRandomValues(out);
    let hex = '';
    for (let i = 0; i < out.length; i++)
      hex += HEX_CHARS[out[i]! & 0xf]! + HEX_CHARS[out[i]! >> 4]!;
    return hex;
  }
  // Documented fallback for runtimes without crypto.getRandomValues.
  let hex = '';
  while (hex.length < bytes * 2) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

const DEFAULT_RANDOM_BYTES = 8;

let defaultRng: IdRng = () => randomHex(DEFAULT_RANDOM_BYTES);

/**
 * Override the default random source. Primarily for deterministic tests;
 * reset with `resetDefaultIdRng()`.
 */
export function setDefaultIdRng(rng: IdRng): void {
  defaultRng = rng;
}

export function resetDefaultIdRng(): void {
  defaultRng = () => randomHex(DEFAULT_RANDOM_BYTES);
}

/**
 * Mint a collision-resistant id: `<prefix><counter>_<random hex>`.
 * The random component (64 bits by default) makes ids minted on
 * independently edited branches of the same document distinct.
 */
export function mintId(prefix: string, counter: number, rng: IdRng = defaultRng): string {
  return `${prefix}${counter}${MINTED_ID_SEPARATOR}${rng()}`;
}

/** True when `id` is in the legacy sequential format for `prefix` (e.g. `n5`). */
export function isLegacyNumericId(id: string, prefix: string): boolean {
  if (!id.startsWith(prefix)) return false;
  const rest = id.slice(prefix.length);
  return /^\d+$/.test(rest);
}

/** True when `id` is in the minted collision-resistant format. */
export function isMintedId(id: string): boolean {
  return MINTED_ID_RE.test(id);
}

/** Parsed minted id: `n12_3fa9c2...` → `{ prefix: 'n', counter: 12, random: '3fa9c2...' }`. */
export interface ParsedMintedId {
  prefix: string;
  counter: number;
  random: string;
}

/** Parse a minted id; returns null when the id is legacy or malformed. */
export function parseMintedId(id: string): ParsedMintedId | null {
  const match = MINTED_ID_RE.exec(id);
  if (!match) return null;
  return { prefix: match[1]!, counter: Number(match[2]), random: match[3]! };
}

/**
 * Counter component of an id in either format, or null for ids that carry
 * no counter (pure-random ids such as pages or assets).
 */
export function idCounter(id: string): number | null {
  const minted = parseMintedId(id);
  if (minted) return minted.counter;
  // Legacy sequential format: alphabetic (and hyphenated) prefix followed by
  // a run of digits at the end (`n12`, `s3`, `col-1`, `v1`). A trailing hex
  // random suffix (minted variables like `v-0123ab`) does not match.
  const legacy = /^([a-z-]+)(\d+)$/.exec(id);
  return legacy ? Number(legacy[2]) : null;
}

/** Create a typed NodeId from a minted id. */
export function toNodeId(id: string): NodeId {
  return id as NodeId;
}

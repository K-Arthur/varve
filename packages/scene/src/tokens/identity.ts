/**
 * Token identity minting (ADR-0102).
 *
 * Token ids are collision-resistant UUIDs ("tok_" + uuid). They are minted
 * per import/creation, never derived from names, paths, or values, and never
 * re-numbered. An id generator can be injected for deterministic tests.
 */
import type { TokenId } from './model';

export type TokenIdGenerator = () => string;

/** crypto-backed UUIDs via globalThis.crypto (node >= 20 and browsers). */
export function createUuidTokenIdGenerator(): TokenIdGenerator {
  return () => {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
}

/** Default generator — crypto-backed UUIDs. */
export function mintTokenId(generate: TokenIdGenerator = createUuidTokenIdGenerator()): TokenId {
  const raw = generate();
  return raw.startsWith('tok_') ? (raw as TokenId) : (`tok_${raw}` as TokenId);
}

/**
 * Deterministic generator for tests: sequential ids so assertions can
 * predict minted values without mocking crypto.
 */
export function createSequentialTokenIdGenerator(): TokenIdGenerator {
  let counter = 0;
  return () => `test-${++counter}`;
}

export function isTokenId(value: unknown): value is TokenId {
  return typeof value === 'string' && /^tok_[A-Za-z0-9_-]+$/.test(value);
}

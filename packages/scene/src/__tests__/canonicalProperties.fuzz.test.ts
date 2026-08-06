/**
 * Property-based tests for canonical serialization (ADR-0027).
 *
 * Properties:
 * - canonicalize(canonicalize(doc)) === canonicalize(doc)
 * - key insertion-order shuffling does not change canonical bytes
 * - canonical hash is stable for identical content
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalizeDocument } from '../canonical';
import { goldenFixtureDocument } from './canonicalGolden.test';

/** Recursively shuffle object key order (keeps arrays and values intact). */
function shuffleKeys<T>(value: T, rng: () => number): T {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rng)) as T;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [keys[i], keys[j]] = [keys[j]!, keys[i]!];
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = shuffleKeys(record[k], rng);
    return out as T;
  }
  return value;
}

describe('canonical serialization properties', () => {
  it('is idempotent under arbitrary key shuffling', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
        let state = seed;
        const rng = (): number => {
          state = (state * 1103515245 + 12345) % 2147483648;
          return state / 2147483648;
        };
        const shuffled = shuffleKeys(goldenFixtureDocument(), rng);
        const once = canonicalizeDocument(shuffled);
        const twice = canonicalizeDocument(JSON.parse(once));
        expect(twice).toBe(once);
      }),
      { numRuns: 30 },
    );
  });

  it('hash is stable across key shuffling', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
        let state = seed;
        const rng = (): number => {
          state = (state * 1103515245 + 12345) % 2147483648;
          return state / 2147483648;
        };
        const shuffled = shuffleKeys(goldenFixtureDocument(), rng);
        expect(canonicalHash(shuffled)).toBe(canonicalHash(goldenFixtureDocument()));
      }),
      { numRuns: 30 },
    );
  });
});

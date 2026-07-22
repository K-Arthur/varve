import { describe, expect, it } from 'vitest';
import { computeChecksum } from './verify';

describe('computeChecksum (SHA-256)', () => {
  it('returns sha256-prefixed hex string', async () => {
    const hash = await computeChecksum('hello world');
    expect(hash.startsWith('sha256-')).toBe(true);
    expect(hash.length).toBe(71); // 'sha256-' + 64 hex chars
  });

  it('produces deterministic output', async () => {
    const a = await computeChecksum('deterministic test');
    const b = await computeChecksum('deterministic test');
    expect(a).toBe(b);
  });

  it('produces different hashes for different input', async () => {
    const a = await computeChecksum('input-a');
    const b = await computeChecksum('input-b');
    expect(a).not.toBe(b);
  });

  it('matches the known SHA-256 of "hello"', async () => {
    const hash = await computeChecksum('hello');
    // Known SHA-256 of "hello" (verified via sha256sum)
    expect(hash).toBe('sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

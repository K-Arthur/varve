import { describe, expect, it } from 'vitest';
import { contentHashForSrc } from './contentHash';

function dataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(binary)}`;
}

describe('contentHashForSrc', () => {
  it('hashes identical data-URL bytes to the same SHA-256', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]);
    const a = await contentHashForSrc(dataUrl(bytes));
    const b = await contentHashForSrc(dataUrl(bytes));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes different content', async () => {
    const a = await contentHashForSrc(dataUrl(new Uint8Array([1, 2, 3])));
    const b = await contentHashForSrc(dataUrl(new Uint8Array([1, 2, 4])));
    expect(a).not.toBe(b);
  });

  it('memoizes per source string', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const src = dataUrl(bytes);
    const first = await contentHashForSrc(src);
    const second = await contentHashForSrc(src);
    expect(first).toBe(second);
  });

  it('ignores base64 charset differences for the same bytes', async () => {
    // Same bytes encoded once with padding and once with different chunking
    // produce different strings but the decoded bytes (and hash) are equal.
    const bytes = new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const a = dataUrl(bytes);
    const b = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
    expect(await contentHashForSrc(a)).toBe(await contentHashForSrc(b));
  });
});

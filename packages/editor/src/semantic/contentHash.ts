/**
 * Content identity for semantic-embedding caching.
 *
 * The persistent embedding store keys on a content hash so that the same
 * bytes re-imported (new data URL, renamed file, duplicated asset) reuse
 * the derived embedding, while any pixel change produces a new hash and a
 * recompute. Document image sources are typically data URLs; blob: and
 * http(s) sources are fetched. Hashing is memoized per source string.
 */

const hashMemo = new Map<string, Promise<string>>();

/** SHA-256 of the source image bytes (data URL or fetchable URL). */
export function contentHashForSrc(src: string): Promise<string> {
  let pending = hashMemo.get(src);
  if (!pending) {
    pending = computeContentHash(src).finally(() => {
      // Keep failed hashes out of the memo so a transient failure can retry.
      hashMemo.delete(src);
    });
    hashMemo.set(src, pending);
  }
  return pending;
}

async function computeContentHash(src: string): Promise<string> {
  const bytes = await srcBytes(src);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function srcBytes(src: string): Promise<ArrayBuffer> {
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    const meta = comma >= 0 ? src.slice(5, comma) : '';
    const payload = comma >= 0 ? src.slice(comma + 1) : src;
    if (meta.includes(';base64')) {
      const bin = atob(payload);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
  }
  const response = await fetch(src, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Failed to load image content for hashing: ${src}`);
  return response.arrayBuffer();
}

import { getFontRegistry } from '../fontRegistry';
import { FontBinaryCache, getBinaryCache } from './fontCache';
import { loadStoredFont, listStoredFonts } from './fontStorage';

export interface FontDataRecord {
  family: string;
  data: Uint8Array;
}

export interface FontCollectOptions {
  /** Also attempt to fetch bundled fonts by URL (may be slow). */
  fetchBundled?: boolean;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Callback per font attempted. */
  onProgress?: (family: string, status: 'cached' | 'storage' | 'fetched' | 'missing') => void;
}

const BINARY_CACHE_KEY_PREFIX = 'font-binary:';

function familyKey(family: string): string {
  return `${BINARY_CACHE_KEY_PREFIX}${family.toLowerCase()}`;
}

async function decompressWoff2(data: Uint8Array): Promise<Uint8Array | null> {
  if (data.byteLength < 4) return null;
  const header = new Uint8Array(data.buffer, data.byteOffset, 4);
  if (header[0] !== 0x77 || header[1] !== 0x4f || header[2] !== 0x46 || header[3] !== 0x32) {
    return null;
  }
  try {
    const { decompress } = await import('wawoff2');
    const result = await decompress(data);
    return new Uint8Array(result);
  } catch {
    try {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        void writer.write(data);
        void writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const total = chunks.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result;
      }
    } catch {
      // not available
    }
  }
  return null;
}

async function fetchFontData(url: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const decompressed = await decompressWoff2(data);
    return decompressed ?? data;
  } catch {
    return null;
  }
}

export async function collectFontData(
  families: string[],
  options: FontCollectOptions = {},
): Promise<FontDataRecord[]> {
  const { fetchBundled = true, signal, onProgress } = options;
  const results: FontDataRecord[] = [];
  const seen = new Set<string>();
  const cache = getBinaryCache();

  for (const rawFamily of families) {
    if (signal?.aborted) break;
    const family = rawFamily.trim();
    if (!family || seen.has(family.toLowerCase())) continue;
    seen.add(family.toLowerCase());
    onProgress?.(family, 'cached');

    // 1. Check in-memory cache
    const cached = cache.getFontData(family);
    if (cached) {
      results.push({ family, data: new Uint8Array(cached) });
      onProgress?.(family, 'cached');
      continue;
    }

    // 2. Check IndexedDB storage
    try {
      const stored = await loadStoredFont(family);
      if (stored?.data) {
        results.push({ family, data: stored.data });
        // Warm the binary cache
        cache.storeFontData(family, stored.data.buffer);
        onProgress?.(family, 'storage');
        continue;
      }
    } catch {
      // IndexedDB unavailable
    }

    // 3. Check FontRegistry for bundled URL
    if (fetchBundled) {
      try {
        const registry = getFontRegistry();
        const entries = registry?.getEntries(family) ?? [];
        const bundled = entries.find(
          (e) => e.source === 'bundled' && e.url,
        );
        if (bundled?.url) {
          const data = await fetchFontData(bundled.url, signal);
          if (data) {
            results.push({ family, data });
            cache.storeFontData(family, data.buffer);
            onProgress?.(family, 'fetched');
            continue;
          }
        }
      } catch {
        // Registry unavailable
      }
    }

    onProgress?.(family, 'missing');
  }

  return results;
}

export async function collectAllStoredFonts(): Promise<FontDataRecord[]> {
  const results: FontDataRecord[] = [];
  try {
    const stored = await listStoredFonts();
    for (const record of stored) {
      if (record.family && record.data) {
        results.push({ family: record.family, data: record.data });
      }
    }
  } catch {
    // IndexedDB unavailable
  }
  return results;
}

export function getBinaryCache(): FontBinaryCache {
  const global_ = globalThis as unknown as Record<string, unknown>;
  if (!global_['__strata_font_binary_cache']) {
    global_['__strata_font_binary_cache'] = new FontBinaryCache();
  }
  return global_['__strata_font_binary_cache'] as FontBinaryCache;
}

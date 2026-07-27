import { getFontRegistry } from '../fontRegistry';
import { listStoredFonts, loadStoredFont } from './fontStorage';

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

function isWoff2(data: Uint8Array): boolean {
  if (data.byteLength < 4) return false;
  return data[0] === 0x77 && data[1] === 0x4f && data[2] === 0x46 && data[3] === 0x32;
}

async function decompressWoff2(data: Uint8Array): Promise<Uint8Array | null> {
  if (!isWoff2(data)) return null;
  try {
    const { decompress } = await import('wawoff2');
    const result = await decompress(data);
    return new Uint8Array(result);
  } catch {
    try {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        void writer.write(copy);
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

  for (const rawFamily of families) {
    if (signal?.aborted) break;
    const family = rawFamily.trim();
    if (!family || seen.has(family.toLowerCase())) continue;
    seen.add(family.toLowerCase());
    onProgress?.(family, 'cached');

    // 1. Check IndexedDB storage
    try {
      const stored = await loadStoredFont(family);
      if (stored?.data) {
        results.push({ family, data: stored.data });
        onProgress?.(family, 'storage');
        continue;
      }
    } catch {
      // IndexedDB unavailable
    }

    // 2. Check FontRegistry for bundled URL
    if (fetchBundled) {
      try {
        const registry = getFontRegistry();
        const entries = registry?.getEntries(family) ?? [];
        const bundled = entries.find((e) => e.source === 'bundled' && e.url);
        if (bundled?.url) {
          const data = await fetchFontData(bundled.url, signal);
          if (data) {
            results.push({ family, data });
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

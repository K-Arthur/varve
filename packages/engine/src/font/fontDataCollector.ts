import { getFontRegistry } from '../fontRegistry';
import type { FontReference } from './fontIdentity';
import { fontReferenceKey } from './fontIdentity';
import { listStoredFonts, loadStoredFont } from './fontStorage';
import { loadFontFromFilesystem } from './fontStorageFs';

export interface FontDataRequest {
  family: string;
  /** Resolve this exact artifact/member; never silently fall back to a family. */
  fontReference?: FontReference;
}

export interface FontDataRecord {
  family: string;
  data: Uint8Array;
  fontReference?: FontReference;
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
  families: readonly (string | FontDataRequest)[],
  options: FontCollectOptions = {},
): Promise<FontDataRecord[]> {
  const { fetchBundled = true, signal, onProgress } = options;
  const results: FontDataRecord[] = [];
  const seen = new Set<string>();

  for (const rawRequest of families) {
    if (signal?.aborted) break;
    const request = typeof rawRequest === 'string' ? { family: rawRequest } : rawRequest;
    const family = request.family.trim();
    const requestKey = request.fontReference
      ? fontReferenceKey(request.fontReference)
      : family.toLowerCase();
    if (!family || seen.has(requestKey)) continue;
    seen.add(requestKey);
    onProgress?.(family, 'cached');

    // 1. Check the exact application storage record. An exact request must
    // never be satisfied by a different artifact that happens to share its
    // family name.
    try {
      const stored = request.fontReference
        ? await loadFontFromFilesystem(request.fontReference)
        : await loadStoredFont(family);
      if (stored?.data) {
        results.push({
          family,
          data: new Uint8Array(stored.data),
          ...(request.fontReference ? { fontReference: request.fontReference } : {}),
        });
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
        const requestedFaceKey = request.fontReference
          ? fontReferenceKey(request.fontReference)
          : undefined;
        const bundled = entries.find(
          (entry) =>
            entry.source === 'bundled' &&
            entry.url &&
            (!request.fontReference ||
              entry.faceKey === requestedFaceKey ||
              (request.fontReference.postScriptName !== undefined &&
                entry.postScriptName === request.fontReference.postScriptName)),
        );
        if (bundled?.url) {
          const data = await fetchFontData(bundled.url, signal);
          if (data) {
            results.push({
              family,
              data,
              ...(request.fontReference ? { fontReference: request.fontReference } : {}),
            });
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
      if (record.familyName && record.data) {
        results.push({ family: record.familyName, data: new Uint8Array(record.data) });
      }
    }
  } catch {
    // IndexedDB unavailable
  }
  return results;
}

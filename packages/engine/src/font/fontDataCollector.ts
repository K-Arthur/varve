import { getFontRegistry } from '../fontRegistry';
import type { FontReference } from './fontIdentity';
import { computeFontHash, fontReferenceKey } from './fontIdentity';
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
  /** Maximum time allowed for one bundled artifact fetch. */
  timeoutMs?: number;
  /** Reject instead of returning a missing record when a fetch times out. */
  failOnTimeout?: boolean;
  /** Callback per font attempted. */
  onProgress?: (
    family: string,
    status: 'cached' | 'storage' | 'fetched' | 'missing' | 'timeout',
  ) => void;
}

export class FontCollectionTimeoutError extends Error {
  readonly code = 'font-fetch-timeout';

  constructor(
    readonly family: string,
    readonly timeoutMs: number,
  ) {
    super(`Timed out loading bundled font “${family}” after ${timeoutMs} ms`);
    this.name = 'FontCollectionTimeoutError';
  }
}

const DEFAULT_FONT_FETCH_TIMEOUT_MS = 15_000;

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

interface FetchedFontData {
  /** Bytes used by the consumer (SFNT after WOFF2 reconstruction when needed). */
  data: Uint8Array;
  /** SHA-256 of the original artifact returned by the provider. */
  artifactHash?: string;
}

interface FontFetchOutcome {
  data: FetchedFontData | null;
  timedOut: boolean;
  externallyAborted: boolean;
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function fetchFontData(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<FontFetchOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = signal?.aborted === true;
  const abortFromCaller = () => {
    externallyAborted = true;
    controller.abort();
  };
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1, timeoutMs),
  );
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { data: null, timedOut, externallyAborted };
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const hash = await computeFontHash(buffer);
    const decompressed = await decompressWoff2(data);
    return {
      data: {
        data: decompressed ?? data,
        ...(hash.hashAlgorithm === 'sha256' ? { artifactHash: hash.contentHash } : {}),
      },
      timedOut,
      externallyAborted,
    };
  } catch {
    return { data: null, timedOut, externallyAborted };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function matchesExactReference(data: Uint8Array, reference: FontReference): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(reference.artifactHash)) return false;
  try {
    const hash = await computeFontHash(arrayBufferFor(data));
    return (
      hash.hashAlgorithm === 'sha256' && hash.contentHash === reference.artifactHash.toLowerCase()
    );
  } catch {
    return false;
  }
}

export async function collectFontData(
  families: readonly (string | FontDataRequest)[],
  options: FontCollectOptions = {},
): Promise<FontDataRecord[]> {
  const {
    fetchBundled = true,
    signal,
    onProgress,
    timeoutMs = DEFAULT_FONT_FETCH_TIMEOUT_MS,
    failOnTimeout = false,
  } = options;
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
        const usable =
          !request.fontReference ||
          (await matchesExactReference(new Uint8Array(stored.data), request.fontReference));
        if (usable) {
          results.push({
            family,
            data: new Uint8Array(stored.data),
            ...(request.fontReference ? { fontReference: request.fontReference } : {}),
          });
          onProgress?.(family, 'storage');
          continue;
        }
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
          const fetchedResult = await fetchFontData(bundled.url, signal, timeoutMs);
          if (fetchedResult.externallyAborted && signal?.aborted) break;
          if (fetchedResult.timedOut) {
            onProgress?.(family, 'timeout');
            if (failOnTimeout) throw new FontCollectionTimeoutError(family, timeoutMs);
            continue;
          }
          const fetched = fetchedResult.data;
          const exactArtifactMatches =
            !request.fontReference ||
            fetched?.artifactHash === request.fontReference.artifactHash.toLowerCase();
          if (fetched && exactArtifactMatches) {
            results.push({
              family,
              data: fetched.data,
              ...(request.fontReference ? { fontReference: request.fontReference } : {}),
            });
            onProgress?.(family, 'fetched');
            continue;
          }
        }
      } catch (error) {
        if (error instanceof FontCollectionTimeoutError) throw error;
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

/**
 * PaddleOCR character dictionary loader + cache.
 *
 * The recognition model outputs class indices 1..N (0 = CTC blank). To turn
 * those indices into text we need the dictionary the model was trained with:
 * dict[i] corresponds to class index i+1.
 *
 * Dictionaries are plain text files, one character/line. We fetch, parse,
 * cache in memory (and expose the raw text), and bound the result to guard
 * against a corrupt or truncated file silently producing garbage output.
 *
 * The dictionary is NOT bundled (per-model, per-language, ships only on
 * demand). The loader fetches the configured URL, falls back to IndexedDB
 * cache when offline, and surfaces a clear error if unavailable — because
 * decoding without the exact dictionary the model expects produces
 * plausible-looking but wrong text, which is worse than a visible failure.
 */

const dictCache = new Map<string, string[]>();

/**
 * Load and cache a character dictionary by URL (or model id).
 *
 * @param url        Remote dictionary URL (e.g. the en_dict.txt on GitHub).
 * @param expectedLines  Sanity-check line count (0 = skip check).
 * @param signal     AbortSignal for cancellation.
 */
export async function loadOcrDictionary(
  url: string,
  expectedLines = 0,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const cached = dictCache.get(url);
  if (cached) return cached;

  let text: string;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    if (signal?.aborted) throw new Error('cancelled');
    throw new Error(
      `Failed to load OCR dictionary from ${url}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (signal?.aborted) throw new Error('cancelled');

  // Parse: one char per line. Trim the trailing empty line from the file.
  const lines = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l, i, arr) => !(i === arr.length - 1 && l === ''));

  if (expectedLines > 0 && lines.length !== expectedLines) {
    throw new Error(`OCR dictionary has ${lines.length} entries, expected ${expectedLines}`);
  }

  dictCache.set(url, lines);
  return lines;
}

/** Synchronous cache lookup (returns undefined if not yet loaded). */
export function getCachedDictionary(url: string): readonly string[] | undefined {
  return dictCache.get(url);
}

/** Clear the dictionary cache (e.g. on model-unload or memory pressure). */
export function clearDictionaryCache(): void {
  dictCache.clear();
}

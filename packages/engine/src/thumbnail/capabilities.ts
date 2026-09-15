/**
 * Thumbnail capability detection — runtime checks for browser APIs
 * that thumbnail generation depends on.
 *
 * Every check is evaluated lazily and cached. Supports test overrides
 * via `setThumbnailCapabilitiesForTest` — when overrides are set or
 * cleared, all cached values are reset so the next read re-evaluates.
 *
 * Research basis: feature detection over user-agent sniffing (MDN
 * best practice). Each capability is decoupled so a missing
 * OffscreenCanvas doesn't prevent HTML canvas from working.
 */

export interface ThumbnailCapabilities {
  offscreenCanvas: boolean;
  fileReader: boolean;
  createImageBitmap: boolean;
  imageEncoding: boolean;
  worker: boolean;
  domCanvas: boolean;
  anyCanvas: boolean;
}

// ─── Override support for tests ────────────────────────────────────────

const overrides = new Map<string, boolean | undefined>();

/** Pending invalidation counter — bumped when overrides change. */
let _generation = 0;

export function setThumbnailCapabilitiesForTest(caps: Partial<ThumbnailCapabilities> | null): void {
  overrides.clear();
  if (caps) {
    for (const [key, value] of Object.entries(caps)) {
      overrides.set(key, value);
    }
  }
  _generation++;
}

/** Retrieve an override or undefined when none is set. */
function getOverride(name: string): boolean | undefined {
  return overrides.get(name);
}

// ─── Cache-aware check factory ────────────────────────────────────────

function makeCheck(name: string, fn: () => boolean): () => boolean {
  let cached: { value: boolean; gen: number } | undefined;
  return () => {
    // Check override first (always fresh)
    const o = getOverride(name);
    if (o !== undefined) return o;

    // When no override, use cached value if generation matches
    if (cached !== undefined && cached.gen === _generation) {
      return cached.value;
    }

    // Evaluate, cache, and return
    const value = fn();
    cached = { value, gen: _generation };
    return value;
  };
}

export const hasOffscreenCanvas = makeCheck('offscreenCanvas', () => {
  if (typeof OffscreenCanvas === 'undefined') return false;
  try {
    return new OffscreenCanvas(1, 1).getContext('2d') !== null;
  } catch {
    return false;
  }
});

export const hasFileReader = makeCheck('fileReader', () => typeof FileReader !== 'undefined');

export const hasCreateImageBitmap = makeCheck(
  'createImageBitmap',
  () => typeof createImageBitmap !== 'undefined',
);

export const hasImageEncoding = makeCheck('imageEncoding', () => {
  if (hasOffscreenCanvas()) {
    try {
      return typeof new OffscreenCanvas(1, 1).convertToBlob === 'function';
    } catch {
      return false;
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      return typeof c.toDataURL === 'function';
    } catch {
      return false;
    }
  }
  return false;
});

export const hasWorkerSupport = makeCheck('worker', () => typeof Worker !== 'undefined');

export const hasDomCanvas = makeCheck('domCanvas', () => {
  if (typeof document === 'undefined') return false;
  try {
    return document.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
});

export const hasAnyCanvas = makeCheck('anyCanvas', () => hasOffscreenCanvas() || hasDomCanvas());

export function getThumbnailCapabilities(): ThumbnailCapabilities {
  return {
    offscreenCanvas: hasOffscreenCanvas(),
    fileReader: hasFileReader(),
    createImageBitmap: hasCreateImageBitmap(),
    imageEncoding: hasImageEncoding(),
    worker: hasWorkerSupport(),
    domCanvas: hasDomCanvas(),
    anyCanvas: hasAnyCanvas(),
  };
}

/**
 * FontLoader — runtime font loading and registration for browser and Tauri.
 *
 * Wraps the CSS Font Loading API (FontFace / document.fonts) and integrates
 * with the existing FontRegistry singleton so that every font loaded through
 * FontLoader is immediately visible to editor UI components.
 *
 * Research basis: CSS Font Loading API (W3C), Figma font loading strategy,
 * Google Fonts API self-hosting docs.
 */

import { type FontRegistry, getFontRegistry } from '../fontRegistry';
import type { ParsedFontMetadata } from './fontIdentity';
import { parseFontData } from './fontParser';

// ── Types ──────────────────────────────────────────────────────────────────

export interface FontLoaderConfig {
  /** Max concurrent font loads (default 3). */
  maxConcurrent?: number;
  /** Timeout per font load in ms (default 10 000). */
  timeoutMs?: number;
  /** Number of retries on network failure (default 2). */
  retryCount?: number;
}

export interface LoadResult {
  success: boolean;
  family: string;
  error?: string;
  loadedFrom: 'cache' | 'network' | 'local' | 'system';
}

type Listener = () => void;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Safe list of system font families available on all major platforms. */
const SYSTEM_FONTS: string[] = [
  'Arial',
  'Arial Black',
  'Comic Sans MS',
  'Courier',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Helvetica Neue',
  'Impact',
  'Lucida Console',
  'Lucida Grande',
  'Monaco',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Noto Sans',
  'Noto Sans CJK',
  'Meiryo',
  'PingFang SC',
  'PingFang TC',
  'PingFang HK',
  'Hiragino Sans',
  'Apple SD Gothic Neo',
];

/** True when running inside the Tauri desktop shell. */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/** Result shape returned by the `enumerate_system_fonts` Tauri command. */
export interface SystemFontFace {
  family: string;
  name: string;
  path: string;
  style: string;
  weight: number;
  stretch: number;
}

function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Font load timed out after ${ms}ms`)), ms);
  });
}

function weightFromSubfamily(subfamily: string): number {
  const lower = subfamily.toLowerCase();
  if (lower.includes('thin')) return 100;
  if (lower.includes('extralight') || lower.includes('extra light')) return 200;
  if (lower.includes('light')) return 300;
  if (lower.includes('medium')) return 500;
  if (lower.includes('semibold') || lower.includes('semi bold')) return 600;
  if (lower.includes('bold')) return 700;
  if (lower.includes('extrabold') || lower.includes('extra bold')) return 800;
  if (lower.includes('black')) return 900;
  return 400;
}

// ── FontLoader ─────────────────────────────────────────────────────────────

export class FontLoader {
  private config: Required<FontLoaderConfig>;
  private registry: FontRegistry;
  private loaded = new Map<string, LoadResult>();
  private inFlight = new Map<string, Promise<LoadResult>>();
  private listeners = new Set<Listener>();

  constructor(config?: FontLoaderConfig, registry?: FontRegistry) {
    this.config = {
      maxConcurrent: config?.maxConcurrent ?? 3,
      timeoutMs: config?.timeoutMs ?? 10_000,
      retryCount: config?.retryCount ?? 2,
    };
    this.registry = registry ?? getFontRegistry();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Load a font into the browser runtime from metadata and optional binary data.
   *
   * - If `data` is provided, creates a FontFace from the ArrayBuffer.
   * - If no data and no URL, tries `local(family)` for system fonts.
   * - If a URL is present in metadata, fetches the font file.
   */
  async loadFont(meta: ParsedFontMetadata, data?: ArrayBuffer): Promise<LoadResult> {
    const family = meta.identity.familyName;

    // Deduplicate concurrent loads of the same family
    const existing = this.inFlight.get(family);
    if (existing) return existing;

    const promise = this._loadFontInner(meta, data);
    this.inFlight.set(family, promise);
    try {
      const result = await promise;
      return result;
    } finally {
      this.inFlight.delete(family);
    }
  }

  private async _loadFontInner(meta: ParsedFontMetadata, data?: ArrayBuffer): Promise<LoadResult> {
    const family = meta.identity.familyName;

    try {
      if (data) {
        return await this.loadFromArrayBuffer(family, data, 'network');
      }

      if (meta.sourceLocation) {
        return await this.loadFontFromUrl(family, meta.sourceLocation);
      }

      // Try local() source for system fonts
      return await this.loadLocalFont(family);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: LoadResult = { success: false, family, error: message, loadedFrom: 'system' };
      this.loaded.set(family, result);
      this.notify();
      return result;
    }
  }

  /** Fetch a font from a URL and register it. */
  async loadFontFromUrl(family: string, url: string): Promise<LoadResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }

        const buffer = await response.arrayBuffer();
        const result = await this.loadFromArrayBuffer(family, buffer, 'network');
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const result: LoadResult = {
      success: false,
      family,
      error: lastError ?? 'Unknown fetch error',
      loadedFrom: 'network',
    };
    this.loaded.set(family, result);
    this.notify();
    return result;
  }

  /** Load a font from a Blob. */
  async loadFontFromBlob(family: string, blob: Blob): Promise<LoadResult> {
    const buffer = await blob.arrayBuffer();
    return this.loadFromArrayBuffer(family, buffer, 'local');
  }

  /** Batch load fonts with concurrency limit. */
  async loadFonts(metas: ParsedFontMetadata[]): Promise<LoadResult[]> {
    const results: LoadResult[] = [];
    const queue = [...metas];

    const workers = Array.from({ length: this.config.maxConcurrent }, async () => {
      while (queue.length > 0) {
        const meta = queue.shift()!;
        const result = await this.loadFont(meta);
        results.push(result);
      }
    });

    await Promise.all(workers);
    return results;
  }

  /** Check if a font family is available in the browser. */
  isFontAvailable(family: string): boolean {
    if (typeof document === 'undefined' || !document.fonts) return false;
    return document.fonts.check(`16px "${family}"`);
  }

  /** Get all successfully loaded font family names. */
  getLoadedFonts(): string[] {
    return [...this.loaded.entries()].filter(([, r]) => r.success).map(([family]) => family);
  }

  /** Remove a font from document.fonts and the cache. */
  unloadFont(family: string): boolean {
    if (typeof document === 'undefined' || !document.fonts) return false;

    let removed = false;
    for (const face of document.fonts) {
      if (face.family === family) {
        document.fonts.delete(face);
        removed = true;
      }
    }

    if (removed) {
      this.loaded.delete(family);
      this.notify();
    }

    return removed;
  }

  /** Subscribe to font-load state changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async loadFromArrayBuffer(
    family: string,
    data: ArrayBuffer,
    source: 'network' | 'local',
  ): Promise<LoadResult> {
    if (typeof document === 'undefined' || !document.fonts) {
      const result: LoadResult = {
        success: false,
        family,
        error: 'No document.fonts available',
        loadedFrom: source,
      };
      this.loaded.set(family, result);
      this.notify();
      return result;
    }

    // Parse metadata before loading so we can register accurate weight/style,
    // color capabilities, and license info alongside the FontRegistry entry.
    let meta: ParsedFontMetadata | undefined;
    try {
      meta = await parseFontData(data);
    } catch {
      // Parse errors are non-fatal; we fall back to generic registration below.
    }

    const face = new FontFace(family, data);
    try {
      await Promise.race([face.load(), createTimeout(this.config.timeoutMs)]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: LoadResult = { success: false, family, error: message, loadedFrom: source };
      this.loaded.set(family, result);
      this.notify();
      return result;
    }

    document.fonts.add(face);
    await document.fonts.ready;

    const result: LoadResult = { success: true, family, loadedFrom: source };
    this.loaded.set(family, result);

    // Register in FontRegistry so existing UI components see the font
    const subfamily = meta?.identity.subfamilyName ?? 'Regular';
    this.registry.register({
      family,
      weight: weightFromSubfamily(subfamily),
      style: subfamily.toLowerCase().includes('italic') ? 'italic' : 'normal',
      source: 'bundled',
    });

    if (meta) {
      this.registry.registerMetadata({
        family,
        postScriptName: meta.identity.postScriptName,
        format: meta.format,
        vendor: meta.vendor,
        version: meta.version,
        copyright: meta.copyright,
        license: meta.license,
        embeddingRights: meta.embeddingRights,
        hasColorGlyphs: meta.hasColorGlyphs,
        colorFormats: meta.colorFormats,
        paletteCount: meta.paletteCount,
        openTypeFeatures: meta.openTypeFeatures,
        glyphCount: meta.glyphCount,
        unitsPerEm: meta.unitsPerEm,
        ascender: meta.ascender,
        descender: meta.descender,
        lineGap: meta.lineGap,
      });
    }

    this.notify();
    return result;
  }

  private async loadLocalFont(family: string): Promise<LoadResult> {
    if (typeof document === 'undefined' || !document.fonts) {
      const result: LoadResult = {
        success: false,
        family,
        error: 'No document.fonts available',
        loadedFrom: 'system',
      };
      this.loaded.set(family, result);
      this.notify();
      return result;
    }

    const face = new FontFace(family, `local(${family})`);
    try {
      await Promise.race([face.load(), createTimeout(this.config.timeoutMs)]);
    } catch {
      // local() source failed — font not installed on this system
      const result: LoadResult = {
        success: false,
        family,
        error: `Font "${family}" not available locally`,
        loadedFrom: 'system',
      };
      this.loaded.set(family, result);
      this.notify();
      return result;
    }

    document.fonts.add(face);
    await document.fonts.ready;

    const result: LoadResult = { success: true, family, loadedFrom: 'system' };
    this.loaded.set(family, result);

    this.registry.register({
      family,
      weight: 400,
      style: 'normal',
      source: 'system',
    });

    this.notify();
    return result;
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // Don't let subscriber errors break the notification loop
      }
    }
  }
}

// ── System Font Detection ─────────────────────────────────────────────────

/**
 * Browser Local Font Access API types (Chrome 103+, Edge 103+).
 */
interface LocalFontMetadata {
  postscriptName: string;
  fullName: string;
  family: string;
  style: string;
}

interface QueryLocalFontsOptions {
  postscriptNames?: string[];
}

interface WindowWithLocalFonts extends Window {
  queryLocalFonts?(options?: QueryLocalFontsOptions): Promise<LocalFontMetadata[]>;
}

/** Cache for queryLocalFonts results (enumerated once per session). */
let _enumeratedSystemFamilies: string[] | null = null;
let _enumeratedSystemFonts: LocalFontMetadata[] | null = null;

/**
 * Check whether the browser supports the Local Font Access API.
 */
export function hasQueryLocalFonts(): boolean {
  if (typeof window === 'undefined') return false;
  return 'queryLocalFonts' in window;
}

/**
 * Enumerate system fonts using the Tauri native backend when available,
 * otherwise the Local Font Access API (Chrome 103+), finally falling back
 * to a hardcoded safe list.
 *
 * Requires a user gesture (transient activation) on first call for the browser API.
 * Results are cached for the session — subsequent calls return immediately.
 */
export async function enumerateSystemFonts(): Promise<string[]> {
  if (_enumeratedSystemFamilies) return _enumeratedSystemFamilies;

  // Prefer the Tauri native command; it works without browser permissions and
  // gives us richer metadata (path, weight, style) for each face.
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const faces = await invoke<SystemFontFace[]>('enumerate_system_fonts', {});
      const registry = getFontRegistry();
      const familySet = new Set<string>();

      for (const face of faces) {
        familySet.add(face.family);
        registry.register({
          family: face.family,
          weight: Math.round(face.weight),
          style: face.style.includes('italic') ? 'italic' : 'normal',
          source: 'system',
        });
      }

      const families = [...familySet].sort();
      _enumeratedSystemFamilies = families;
      // Expose full face details through getCachedLocalFontMetadata semantics.
      _enumeratedSystemFonts = faces.map((f) => ({
        postscriptName: f.name,
        fullName: f.name,
        family: f.family,
        style: f.style,
      }));
      return families;
    } catch {
      // Tauri command failed — fall through to browser API or safe list.
    }
  }

  if (hasQueryLocalFonts()) {
    try {
      const win = window as WindowWithLocalFonts;
      const fonts = await win.queryLocalFonts!();
      _enumeratedSystemFonts = fonts;
      const families = [...new Set(fonts.map((f) => f.family))].sort();
      _enumeratedSystemFamilies = families;
      return families;
    } catch {
      // Permission denied or API error — fall through to safe list
    }
  }

  // Fallback: safe list of fonts available across Windows, macOS, and Linux
  _enumeratedSystemFamilies = [...SYSTEM_FONTS];
  return _enumeratedSystemFamilies;
}

/**
 * Get detailed local font metadata from the session cache.
 * Returns null if queryLocalFonts has not been called or is unavailable.
 */
export function getCachedLocalFontMetadata(): LocalFontMetadata[] | null {
  return _enumeratedSystemFonts;
}

/**
 * Reset cached system font enumeration (for testing or when fonts change).
 */
export function resetSystemFontCache(): void {
  _enumeratedSystemFamilies = null;
  _enumeratedSystemFonts = null;
}

/**
 * Return a safe list of system font families.
 *
 * Uses the cached Local Font Access API result if available, otherwise
 * returns a hardcoded list of fonts commonly available across
 * Windows, macOS, and Linux.
 */
export function detectSystemFonts(): string[] {
  if (_enumeratedSystemFamilies) return _enumeratedSystemFamilies;
  return [...SYSTEM_FONTS];
}

/**
 * Try to load system fonts via `local()` source.
 * Returns results for each family — success means the font exists locally.
 */
export async function loadSystemFontsViaLocal(families: string[]): Promise<LoadResult[]> {
  const loader = new FontLoader();
  return loader.loadFonts(
    families.map((family) => ({
      identity: {
        contentHash: '',
        postScriptName: family,
        familyName: family,
        subfamilyName: 'Regular',
        fullName: family,
      },
      format: 'unknown' as const,
      fileSize: 0,
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      glyphCount: 0,
      isVariable: false,
      axes: [],
      namedInstances: [],
      openTypeFeatures: [],
      unicodeRanges: [],
      scripts: [],
      embeddingRights: 'unknown' as const,
      hasColorGlyphs: false,
      category: 'sans-serif' as const,
      source: 'system' as const,
    })),
  );
}

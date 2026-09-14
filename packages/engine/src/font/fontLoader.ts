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

import { isTauriRuntime as isTauri } from '@varve/platform';
import { type FontRegistry, getFontRegistry } from '../fontRegistry';
import { extractFontCollectionMember } from './fontCollectionMember';
import {
  fontReferenceFromIdentity,
  fontReferenceKey,
  type ParsedFontMetadata,
} from './fontIdentity';
import { parseFontData } from './fontParser';

export { loadSystemFontFace } from './fontSystemBridge';

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

interface WorkerFaceBridge {
  styleElement: HTMLStyleElement;
  objectUrl: string;
  revision: string;
  faceKey?: string;
}

interface LoadedFaceRecord {
  recordKey: string;
  family: string;
  face: FontFace;
  faceKey?: string;
  bridge?: WorkerFaceBridge;
  result: LoadResult;
}

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

/** Result shape returned by the `enumerate_system_fonts` Tauri command. */
export interface SystemFontFace {
  family: string;
  name: string;
  path: string;
  style: string;
  weight: number;
  stretch: number;
  handle?: string;
  artifactHash?: string;
  collectionIndex?: number;
  faceKey?: string;
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

function portableFaceKey(options?: {
  faceKey?: string;
  artifactHash?: string;
  collectionIndex?: number;
}): string | undefined {
  if (options?.faceKey) return options.faceKey;
  if (!options?.artifactHash || !/^[0-9a-f]{64}$/i.test(options.artifactHash)) return undefined;
  return fontReferenceKey({
    artifactHash: options.artifactHash,
    ...(options.collectionIndex === undefined ? {} : { collectionIndex: options.collectionIndex }),
  });
}

function exactFaceKey(
  options: { faceKey?: string; artifactHash?: string; collectionIndex?: number } | undefined,
  meta?: ParsedFontMetadata,
): string | undefined {
  const supplied = portableFaceKey(options);
  if (supplied) return supplied;
  const reference = meta ? fontReferenceFromIdentity(meta.identity) : undefined;
  return reference ? fontReferenceKey(reference) : undefined;
}

function cssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\A ');
}

// ── FontLoader ─────────────────────────────────────────────────────────────

export class FontLoader {
  private config: Required<FontLoaderConfig>;
  private registry: FontRegistry;
  private loaded = new Map<string, LoadResult>();
  private inFlight = new Map<string, Promise<LoadResult>>();
  private listeners = new Set<Listener>();
  /** Loaded FontFace objects, keyed by a portable face identity when known. */
  private loadedFaces = new Map<string, LoadedFaceRecord>();
  /** Monotone bridge revision prevents remove/re-add races in render workers. */
  private workerRevision = 0;
  private exactFaceRecords = new Map<string, Set<string>>();
  /** CSS bridges for byte-backed faces so the render worker can adopt them. */
  private workerStyles = new Map<string, HTMLStyleElement[]>();
  private workerObjectUrls = new Map<string, string[]>();

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

    // Deduplicate by the exact artifact/member when a canonical hash exists.
    // Family plus subfamily is retained only for legacy metadata that cannot
    // prove which bytes are being loaded.
    const reference = fontReferenceFromIdentity(meta.identity);
    const key = reference
      ? `face:${fontReferenceKey(reference)}`
      : `${family}\u0000${meta.identity.postScriptName || meta.identity.subfamilyName}`;
    const cached = reference ? this.findLoadedFace(fontReferenceKey(reference)) : undefined;
    if (cached) return cached.result;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this._loadFontInner(meta, data);
    this.inFlight.set(key, promise);
    try {
      const result = await promise;
      return result;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Restore a previously persisted font from raw binary data.
   *
   * This is the public API used by the font-storage restoration flow:
   * it parses the binary, creates a FontFace, registers it with the
   * FontRegistry, and makes it available for canvas/DOM rendering.
   * Skips duplicate-restore gracefully (returns the cached result).
   */
  async restoreFont(
    family: string,
    data: ArrayBuffer,
    storageMetadata?: {
      providerId?: string;
      weight?: number;
      style?: 'normal' | 'italic';
      postScriptName?: string;
      faceKey?: string;
      artifactHash?: string;
      collectionIndex?: number;
      axes?: Array<{ tag: string; name?: string; min: number; max: number; default: number }>;
    },
  ): Promise<LoadResult> {
    const exactKey = portableFaceKey(storageMetadata);
    const key = exactKey
      ? `face:${exactKey}`
      : `${family}\u0000${storageMetadata?.weight ?? 'auto'}:${storageMetadata?.style ?? 'normal'}`;
    const cached = exactKey ? this.findLoadedFace(exactKey) : undefined;
    if (cached) return cached.result;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const registrySource =
      storageMetadata?.providerId === 'fontsource'
        ? 'fontsource'
        : storageMetadata?.providerId === 'google'
          ? 'google'
          : 'user';
    const promise = this.loadFromArrayBufferPublic(
      family,
      data,
      'local',
      registrySource,
      storageMetadata,
    );
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async _loadFontInner(meta: ParsedFontMetadata, data?: ArrayBuffer): Promise<LoadResult> {
    const family = meta.identity.familyName;

    try {
      if (data) {
        return await this.loadFromArrayBuffer(family, data, 'network', 'user', {
          postScriptName: meta.identity.postScriptName,
          artifactHash: meta.identity.contentHash,
          ...(meta.identity.collectionIndex === undefined
            ? {}
            : { collectionIndex: meta.identity.collectionIndex }),
          weight: weightFromSubfamily(meta.identity.subfamilyName),
          style: /italic|oblique/i.test(meta.identity.subfamilyName) ? 'italic' : 'normal',
        });
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
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let response: Response | undefined;
      try {
        const controller = new AbortController();
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(`Font load timed out after ${this.config.timeoutMs}ms`));
          }, this.config.timeoutMs);
        });

        // Keep one deadline across both the response headers and body. A
        // server that accepts the connection and then stalls the body must
        // release the queue slot just like a header timeout.
        response = await Promise.race([fetch(url, { signal: controller.signal }), timeout]);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }

        const buffer = await Promise.race([response.arrayBuffer(), timeout]);
        const result = await this.loadFromArrayBuffer(family, buffer, 'network', 'user');
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // Give fetch implementations that expose a readable body a chance to
        // release it before a retry. This is best effort because some browser
        // responses do not expose a cancelable stream.
        try {
          await response?.body?.cancel();
        } catch {
          // Ignore cleanup failures; the original load error is actionable.
        }
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
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
    const records = [...this.loadedFaces.values()].filter((record) => record.family === family);
    const exactKeys = [
      ...new Set(records.flatMap((record) => (record.faceKey ? [record.faceKey] : []))),
    ];
    let removed = false;
    for (const record of records) {
      removed = this.removeLoadedFace(record) || removed;
    }

    // Keep compatibility with faces that predate exact tracking (or were
    // declared by another loader). Those are still removable by family, but
    // exact byte-backed records above are deleted only once.
    if (typeof document !== 'undefined' && document.fonts) {
      for (const face of document.fonts) {
        if (face.family === family) {
          document.fonts.delete(face);
          removed = true;
        }
      }
    }
    for (const style of this.workerStyles.get(family) ?? []) style.remove();
    this.workerStyles.delete(family);
    for (const url of this.workerObjectUrls.get(family) ?? []) URL.revokeObjectURL(url);
    this.workerObjectUrls.delete(family);

    if (removed) {
      this.loaded.delete(family);
      for (const faceKey of exactKeys) this.registry.unregisterFace({ faceKey });
      this.notify();
    }

    return removed;
  }

  /**
   * Remove every loaded instance of one exact artifact/member.
   *
   * A family can legitimately have two files with the same names and styles;
   * callers removing one imported face must not evict its sibling or leave its
   * worker bridge alive. The portable key is the only selector accepted here.
   */
  unloadFace(faceKey: string): boolean {
    const recordKeys = this.exactFaceRecords.get(faceKey);
    if (!recordKeys?.size) return false;
    let removed = false;
    const families = new Set<string>();
    for (const recordKey of [...recordKeys]) {
      const record = this.loadedFaces.get(recordKey);
      if (record) {
        families.add(record.family);
        removed = this.removeLoadedFace(record) || removed;
      }
    }
    this.exactFaceRecords.delete(faceKey);
    if (removed) {
      this.registry.unregisterFace({ faceKey });
      // `loaded` is a family projection used by getLoadedFonts(). Keep it
      // while a sibling exact face is still loaded, and clear it when this
      // removal evicts the final face for that family.
      for (const family of families) {
        if (![...this.loadedFaces.values()].some((record) => record.family === family)) {
          this.loaded.delete(family);
        }
      }
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

  /** Restore helper — public wrapper around loadFromArrayBuffer. */
  async loadFromArrayBufferPublic(
    family: string,
    data: ArrayBuffer,
    source: 'network' | 'local',
    registrySource: 'system' | 'bundled' | 'google' | 'fontsource' | 'user' = 'user',
    faceOptions?: {
      weight?: number;
      style?: 'normal' | 'italic';
      postScriptName?: string;
      faceKey?: string;
      artifactHash?: string;
      collectionIndex?: number;
      axes?: Array<{ tag: string; name?: string; min: number; max: number; default: number }>;
    },
  ): Promise<LoadResult> {
    return this.loadFromArrayBuffer(family, data, source, registrySource, faceOptions);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async loadFromArrayBuffer(
    family: string,
    data: ArrayBuffer,
    source: 'network' | 'local',
    registrySource: 'system' | 'bundled' | 'google' | 'fontsource' | 'user' = 'user',
    faceOptions?: {
      weight?: number;
      style?: 'normal' | 'italic';
      postScriptName?: string;
      faceKey?: string;
      artifactHash?: string;
      collectionIndex?: number;
      axes?: Array<{ tag: string; name?: string; min: number; max: number; default: number }>;
    },
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
    let artifactMeta: ParsedFontMetadata | undefined;
    let meta: ParsedFontMetadata | undefined;
    let faceData = data;
    try {
      artifactMeta = await parseFontData(data);
      const collectionIndex = faceOptions?.collectionIndex ?? artifactMeta.identity.collectionIndex;
      if (collectionIndex !== undefined && artifactMeta.identity.collectionIndex !== undefined) {
        faceData = await extractFontCollectionMember(data, collectionIndex);
        meta = await parseFontData(faceData);
      } else {
        meta = artifactMeta;
      }
    } catch {
      if (faceOptions?.collectionIndex !== undefined) {
        throw new Error('Font collection member could not be validated');
      }
      // Parse errors are non-fatal; we fall back to generic registration below.
    }

    const collectionIndex = faceOptions?.collectionIndex ?? artifactMeta?.identity.collectionIndex;
    const exactKey = exactFaceKey(
      {
        ...faceOptions,
        ...(faceOptions?.artifactHash || !artifactMeta?.identity.contentHash
          ? {}
          : { artifactHash: artifactMeta.identity.contentHash }),
        ...(collectionIndex === undefined ? {} : { collectionIndex }),
      },
      artifactMeta ?? meta,
    );
    const cached = exactKey ? this.findLoadedFace(exactKey) : undefined;
    if (cached) return cached.result;

    const subfamily = meta?.identity.subfamilyName ?? 'Regular';
    const weight = faceOptions?.weight ?? weightFromSubfamily(subfamily);
    const style =
      faceOptions?.style ?? (subfamily.toLowerCase().includes('italic') ? 'italic' : 'normal');
    const face = new FontFace(family, faceData, { weight: String(weight), style });
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
    const bridge = this.exposeByteBackedFaceToWorkers(family, faceData, weight, style, exactKey);
    await document.fonts.ready;

    const result: LoadResult = { success: true, family, loadedFrom: source };
    this.loaded.set(family, result);
    const recordKey =
      exactKey ?? `${family}\u0000${weight}\u0000${style}\u0000${++this.workerRevision}`;
    const record: LoadedFaceRecord = {
      recordKey,
      family,
      face,
      ...(exactKey ? { faceKey: exactKey } : {}),
      ...(bridge ? { bridge } : {}),
      result,
    };
    this.loadedFaces.set(recordKey, record);
    if (exactKey) {
      const records = this.exactFaceRecords.get(exactKey) ?? new Set<string>();
      records.add(recordKey);
      this.exactFaceRecords.set(exactKey, records);
    }

    // Register in FontRegistry so existing UI components see the font
    const artifactIdentity = artifactMeta?.identity ?? meta?.identity;
    const faceReference = artifactIdentity
      ? fontReferenceFromIdentity({
          ...artifactIdentity,
          ...(collectionIndex === undefined ? {} : { collectionIndex }),
        })
      : undefined;
    this.registry.register({
      family,
      weight,
      style,
      source: registrySource,
      ...(faceOptions?.postScriptName
        ? { postScriptName: faceOptions.postScriptName }
        : meta?.identity.postScriptName
          ? { postScriptName: meta.identity.postScriptName }
          : {}),
      ...(collectionIndex !== undefined
        ? { collectionIndex }
        : meta?.identity.collectionIndex === undefined
          ? {}
          : { collectionIndex: meta.identity.collectionIndex }),
      ...(exactKey
        ? { faceKey: exactKey }
        : faceReference
          ? { faceKey: fontReferenceKey(faceReference) }
          : {}),
      ...(faceOptions?.axes?.length
        ? {
            axisDefinitions: faceOptions.axes.map((axis) => ({
              ...axis,
              name: axis.name ?? axis.tag,
            })),
          }
        : meta?.axes.length
          ? {
              axisDefinitions: meta.axes.map((axis) => ({
                tag: axis.tag,
                name: axis.name,
                min: axis.min,
                default: axis.default,
                max: axis.max,
              })),
            }
          : {}),
      ...(meta?.namedInstances?.length ? { namedInstances: meta.namedInstances } : {}),
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
        embeddingPolicy: meta.embeddingPolicy,
        licenseProvenance: meta.licenseProvenance,
        hasColorGlyphs: meta.hasColorGlyphs,
        colorFormats: meta.colorFormats,
        paletteCount: meta.paletteCount,
        openTypeFeatures: meta.openTypeFeatures,
        namedInstances: meta.namedInstances,
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

  private findLoadedFace(faceKey: string): LoadedFaceRecord | undefined {
    const recordKeys = this.exactFaceRecords.get(faceKey);
    if (!recordKeys) return undefined;
    for (const recordKey of recordKeys) {
      const record = this.loadedFaces.get(recordKey);
      if (record) return record;
    }
    return undefined;
  }

  private removeLoadedFace(record: LoadedFaceRecord): boolean {
    if (!this.loadedFaces.delete(record.recordKey)) return false;
    if (record.faceKey) {
      const records = this.exactFaceRecords.get(record.faceKey);
      records?.delete(record.recordKey);
      if (records && records.size === 0) this.exactFaceRecords.delete(record.faceKey);
    }
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.delete(record.face);
    }
    if (record.bridge) {
      record.bridge.styleElement.remove();
      URL.revokeObjectURL(record.bridge.objectUrl);
      const styles = (this.workerStyles.get(record.family) ?? []).filter(
        (style) => style !== record.bridge!.styleElement,
      );
      if (styles.length > 0) this.workerStyles.set(record.family, styles);
      else this.workerStyles.delete(record.family);
      const urls = (this.workerObjectUrls.get(record.family) ?? []).filter(
        (url) => url !== record.bridge!.objectUrl,
      );
      if (urls.length > 0) this.workerObjectUrls.set(record.family, urls);
      else this.workerObjectUrls.delete(record.family);
    }
    return true;
  }

  /**
   * A FontFace constructed from bytes is visible only to this realm. Mirror
   * the exact bytes through a local blob URL in an @font-face rule so the
   * render worker's stylesheet harvester can adopt the same face. This bridge
   * never fetches or publishes a font artifact.
   */
  private exposeByteBackedFaceToWorkers(
    family: string,
    data: ArrayBuffer,
    weight: number,
    style: 'normal' | 'italic',
    faceKey?: string,
  ): WorkerFaceBridge | undefined {
    if (typeof document === 'undefined' || !document.head) return undefined;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined;
    if (typeof Blob === 'undefined') return undefined;

    try {
      const url = URL.createObjectURL(new Blob([data], { type: 'font/woff2' }));
      const revision = `${family}:${++this.workerRevision}`;
      const cssFamily = cssString(family);
      const marker = [
        `--varve-face-revision:"${cssString(revision)}";`,
        faceKey ? `--varve-face-key:"${cssString(faceKey)}";` : '',
      ].join('');
      const styleElement = document.createElement('style');
      styleElement.dataset.varveFontLoader = family;
      if (faceKey) styleElement.dataset.varveFaceKey = faceKey;
      styleElement.dataset.varveFaceRevision = revision;
      styleElement.textContent = `@font-face{font-family:"${cssFamily}";src:url("${url}");font-weight:${weight};font-style:${style};${marker}}`;
      document.head.append(styleElement);
      this.workerStyles.set(family, [...(this.workerStyles.get(family) ?? []), styleElement]);
      this.workerObjectUrls.set(family, [...(this.workerObjectUrls.get(family) ?? []), url]);
      return { styleElement, objectUrl: url, revision, ...(faceKey ? { faceKey } : {}) };
    } catch {
      // The CSS Font Loading API remains authoritative when the bridge is
      // unavailable (for example in a restricted embedded document).
      return undefined;
    }
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
/** Native entries from the previous explicit refresh, removed before re-scan. */
let _enumeratedNativeFaceKeys: string[] = [];
let _enumeratedNativeHandles: string[] = [];
export type SystemFontDiscoveryStatus =
  | 'unknown'
  | 'native'
  | 'local-api'
  | 'fallback'
  | 'unsupported'
  | 'permission-denied'
  | 'permission-revoked'
  | 'error';
let _systemFontDiscoveryStatus: SystemFontDiscoveryStatus = 'unknown';
/** A successful Local Font Access query lets a later NotAllowedError be
 * identified as revocation rather than first-time denial. This survives an
 * explicit Refresh because the browser permission state is session-scoped. */
let _localFontAccessWasGranted = false;

/**
 * Check whether the browser supports the Local Font Access API.
 */
export function hasQueryLocalFonts(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as WindowWithLocalFonts).queryLocalFonts === 'function';
}

function classifyLocalFontAccessError(
  error: unknown,
): 'permission-denied' | 'permission-revoked' | 'error' {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return _localFontAccessWasGranted ? 'permission-revoked' : 'permission-denied';
  }
  return 'error';
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
      const faces = await invoke<SystemFontFace[]>('enumerate_system_fonts', {
        request: { family: null },
      });
      const registry = getFontRegistry();
      const familySet = new Set<string>();
      const nativeFaceKeys: string[] = [];
      const nativeHandles: string[] = [];

      for (const face of faces) {
        familySet.add(face.family);
        registry.register({
          family: face.family,
          weight: Math.round(face.weight),
          style: face.style.includes('italic') ? 'italic' : 'normal',
          source: 'system',
          postScriptName: face.name,
          sourceLocation: face.path || undefined,
          sourceHandle: face.handle,
          faceKey: face.faceKey,
          collectionIndex: face.collectionIndex,
        });
        if (face.faceKey) nativeFaceKeys.push(face.faceKey);
        if (face.handle) nativeHandles.push(face.handle);
      }

      _enumeratedNativeFaceKeys = nativeFaceKeys;
      _enumeratedNativeHandles = nativeHandles;

      const families = [...familySet].sort();
      _enumeratedSystemFamilies = families;
      _systemFontDiscoveryStatus = 'native';
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
      _localFontAccessWasGranted = true;
      _enumeratedSystemFonts = fonts;
      const registry = getFontRegistry();
      for (const font of fonts) {
        registry.register({
          family: font.family,
          weight: weightFromSubfamily(font.style),
          style: /italic|oblique/i.test(font.style) ? 'italic' : 'normal',
          source: 'system',
          postScriptName: font.postscriptName,
        });
      }
      const families = [...new Set(fonts.map((f) => f.family))].sort();
      _enumeratedSystemFamilies = families;
      _systemFontDiscoveryStatus = 'local-api';
      return families;
    } catch (error) {
      // Permission denial and an implementation/runtime failure need
      // different next actions in the browser UI. Both still fall back to the
      // shipped compatibility list so discovery remains usable offline.
      _systemFontDiscoveryStatus = classifyLocalFontAccessError(error);
    }
  }

  // Fallback: safe list of fonts available across Windows, macOS, and Linux
  _enumeratedSystemFamilies = [...SYSTEM_FONTS];
  if (_systemFontDiscoveryStatus === 'unknown') _systemFontDiscoveryStatus = 'unsupported';
  return _enumeratedSystemFamilies;
}

/** Explain which local-font discovery path supplied the current list. */
export function getSystemFontDiscoveryStatus(): SystemFontDiscoveryStatus {
  return _systemFontDiscoveryStatus;
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
  const registry = getFontRegistry();
  for (const faceKey of _enumeratedNativeFaceKeys) registry.unregisterFace({ faceKey });
  for (const sourceHandle of _enumeratedNativeHandles) {
    registry.unregisterFace({ sourceHandle });
  }
  _enumeratedNativeFaceKeys = [];
  _enumeratedNativeHandles = [];
  _enumeratedSystemFamilies = null;
  _enumeratedSystemFonts = null;
  _systemFontDiscoveryStatus = 'unknown';
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

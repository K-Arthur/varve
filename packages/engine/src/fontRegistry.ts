/**
 * FontRegistry — manages font sources, loading, caching, and fallback chains.
 *
 * Three font sources:
 *   1. System fonts (browser `queryLocalFonts` API or hardcoded safe list)
 *   2. Bundled fonts (@fontsource CSS imports)
 *   3. Google Fonts (optional, via CSS @import or link injection)
 *
 * Variable font axes: entries can specify `variableAxes` for wght/wdth/slnt/opsz
 * axis values. `resolve()` includes `font-variation-settings` when axes are set.
 *
 * Research basis: CSS Font Loading API, Figma font system, Google Fonts API.
 */

export interface FontEntry {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  source: 'system' | 'bundled' | 'google';
  /** URL for Google Fonts CSS API or direct woff2 URL for bundled fonts. */
  url?: string;
  /** Variable font axis values (e.g. { wght: 500, wdth: 75, slnt: 0, opsz: 14 }). */
  variableAxes?: Record<string, number>;
}

export type FontLoadState = 'unknown' | 'loading' | 'loaded' | 'error';

const DEFAULT_FONTS: FontEntry[] = [
  { family: 'IBM Plex Sans Variable', weight: 400, style: 'normal', source: 'bundled' },
  { family: 'IBM Plex Sans Variable', weight: 500, style: 'normal', source: 'bundled' },
  { family: 'IBM Plex Sans Variable', weight: 600, style: 'normal', source: 'bundled' },
  { family: 'IBM Plex Sans Variable', weight: 700, style: 'normal', source: 'bundled' },
  { family: 'Geist Variable', weight: 400, style: 'normal', source: 'bundled' },
  { family: 'Inter', weight: 400, style: 'normal', source: 'system' },
  { family: 'Arial', weight: 400, style: 'normal', source: 'system' },
  { family: 'Arial', weight: 700, style: 'normal', source: 'system' },
  { family: 'Helvetica', weight: 400, style: 'normal', source: 'system' },
  { family: 'Georgia', weight: 400, style: 'normal', source: 'system' },
  { family: 'Georgia', weight: 700, style: 'normal', source: 'system' },
  { family: 'Times New Roman', weight: 400, style: 'normal', source: 'system' },
  { family: 'Times New Roman', weight: 700, style: 'normal', source: 'system' },
  { family: 'Courier New', weight: 400, style: 'normal', source: 'system' },
  { family: 'Courier New', weight: 700, style: 'normal', source: 'system' },
  { family: 'Verdana', weight: 400, style: 'normal', source: 'system' },
  { family: 'Verdana', weight: 700, style: 'normal', source: 'system' },
  { family: 'Trebuchet MS', weight: 400, style: 'normal', source: 'system' },
  { family: 'Noto Sans', weight: 400, style: 'normal', source: 'system' },
  { family: 'Noto Sans CJK', weight: 400, style: 'normal', source: 'system' },
  { family: 'Meiryo', weight: 400, style: 'normal', source: 'system' },
];

/** Known variable font axes registered with the registry. */
export interface VariableAxisInfo {
  tag: string;
  name: string;
  min: number;
  max: number;
  default: number;
}

const STANDARD_AXES: Record<string, VariableAxisInfo> = {
  wght: { tag: 'wght', name: 'Weight', min: 1, max: 1000, default: 400 },
  wdth: { tag: 'wdth', name: 'Width', min: 25, max: 200, default: 100 },
  slnt: { tag: 'slnt', name: 'Slant', min: -90, max: 90, default: 0 },
  opsz: { tag: 'opsz', name: 'Optical Size', min: 6, max: 144, default: 14 },
  ital: { tag: 'ital', name: 'Italic', min: 0, max: 1, default: 0 },
  grad: { tag: 'grad', name: 'Grade', min: -200, max: 150, default: 0 },
  XTRA: { tag: 'XTRA', name: 'X-Transparency', min: 200, max: 700, default: 400 },
  YOPQ: { tag: 'YOPQ', name: 'Y-Opacity', min: 25, max: 135, default: 100 },
  YTLC: { tag: 'YTLC', name: 'Lowercase Height', min: 450, max: 750, default: 528 },
  YTUC: { tag: 'YTUC', name: 'Uppercase Height', min: 600, max: 800, default: 700 },
  YTDE: { tag: 'YTDE', name: 'Descender Depth', min: -500, max: -100, default: -300 },
  YTFI: { tag: 'YTFI', name: 'Figure Height', min: 500, max: 800, default: 700 },
};

export class FontRegistry {
  private entries: Map<string, FontEntry[]> = new Map();
  private loaded: Set<string> = new Set();
  private pending: Map<string, Promise<void>> = new Map();
  private loadState: Map<string, FontLoadState> = new Map();
  /** Track injected link elements to avoid duplicates. */
  private injectedLinks: Set<string> = new Set();
  /** Subscribers notified when any font's load state changes. */
  private _listeners: Set<() => void> = new Set();
  /** Monotone revision for invalidating derived text layout. */
  private _revision = 0;

  constructor(initial?: FontEntry[]) {
    for (const entry of initial ?? DEFAULT_FONTS) {
      this.register(entry);
    }
  }

  /** Subscribe to font-load events. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify(): void {
    this._revision++;
    for (const fn of this._listeners) fn();
  }

  /** Register a font entry (e.g., from system enumeration or Google Fonts API). */
  register(entry: FontEntry): void {
    const existing = this.entries.get(entry.family) ?? [];
    existing.push(entry);
    this.entries.set(entry.family, existing);
    this._revision++;
  }

  /** Stable process-local identity for font-dependent layout cache keys. */
  get revision(): string {
    return `font-registry:${this._revision}`;
  }

  /** Get all registered font families. */
  families(): string[] {
    return [...this.entries.keys()].sort();
  }

  /** Get all registered entries for a family. */
  getEntries(family: string): FontEntry[] {
    return this.entries.get(family) ?? [];
  }

  /** Get all weight/style variants for a family. */
  variants(family: string): { weight: number; style: string }[] {
    const e = this.entries.get(family);
    if (!e) return [];
    return e.map((f) => ({ weight: f.weight, style: f.style }));
  }

  /** Get fallback font families for a given family. */
  fallbackChain(family: string): string[] {
    const generic = ['sans-serif', 'serif', 'monospace'];
    if (generic.includes(family.toLowerCase())) return [];
    return ['sans-serif', 'serif', 'monospace'];
  }

  /** Check if a specific weight and style variant exists for a family. */
  hasVariant(family: string, weight: number, style: string): boolean {
    const e = this.entries.get(family);
    if (!e) return false;
    return e.some((f) => f.weight === weight && f.style === style);
  }

  /** Get variable axis info for a family if it has variableAxes registered. */
  getVariableAxes(family: string): Record<string, number> | undefined {
    const e = this.entries.get(family);
    if (!e) return undefined;
    for (const entry of e) {
      if (entry.variableAxes) return entry.variableAxes;
    }
    return undefined;
  }

  /** Get known standard axis info for a given axis tag. */
  getAxisInfo(tag: string): VariableAxisInfo | undefined {
    return STANDARD_AXES[tag];
  }

  /** Get all standard axis definitions. */
  getAllAxes(): VariableAxisInfo[] {
    return Object.values(STANDARD_AXES);
  }

  /** Inject a <link> element for Google Fonts CSS if not already injected. */
  injectGoogleFontLink(family: string): void {
    if (this.injectedLinks.has(family)) return;
    if (typeof document === 'undefined') return;

    const e = this.entries.get(family);
    if (!e) return;
    const googleEntry = e.find((f) => f.source === 'google' && f.url);
    if (!googleEntry?.url) return;

    const existing = document.querySelector(`link[href="${googleEntry.url}"]`);
    if (existing) {
      this.injectedLinks.add(family);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = googleEntry.url;
    document.head?.appendChild(link);
    this.injectedLinks.add(family);
  }

  /** Load a font using the CSS Font Loading API. */
  async load(family: string): Promise<void> {
    if (this.loaded.has(family)) return;
    if (this.pending.has(family)) return this.pending.get(family);

    const promise = this.doLoad(family);
    this.pending.set(family, promise);
    try {
      await promise;
      this.loaded.add(family);
      this.loadState.set(family, 'loaded');
    } catch {
      this.loadState.set(family, 'error');
    } finally {
      this.pending.delete(family);
      this._notify();
    }
  }

  /** Load all registered families. */
  async loadAll(): Promise<void> {
    const families = [...new Set(this.families())];
    await Promise.all(families.map((f) => this.load(f)));
  }

  private async doLoad(family: string): Promise<void> {
    if (typeof document === 'undefined') return;
    if (!document.fonts) return;

    const e = this.entries.get(family);
    if (!e) throw new Error(`Font "${family}" not registered`);

    const entries = e;

    // For Google Fonts, inject a link element first
    const googleEntry = entries.find((f) => f.source === 'google' && f.url);
    if (googleEntry) {
      this.injectGoogleFontLink(family);
      // Wait for fonts to be ready after link injection
      await document.fonts.ready;
      if (document.fonts.check(`16px "${family}"`)) {
        return;
      }
      // Try with specific weight
      for (const entry of entries) {
        const weight = entry.weight;
        const style = entry.style;
        const query = `${style} ${weight} 16px "${family}"`;
        if (document.fonts.check(query)) {
          return;
        }
      }
      return;
    }

    // For bundled fonts, attempt FontFace load from local source
    const bundledEntry = entries.find((f) => f.source === 'bundled' && f.url);
    if (bundledEntry?.url) {
      const font = new FontFace(family, `url(${bundledEntry.url})`);
      try {
        await font.load();
        document.fonts.add(font);
      } catch {
        // Fall through to local()
      }
      await document.fonts.ready;
      return;
    }

    // For system/bundled fonts without explicit URL, try local()
    const font = new FontFace(family, `local(${family})`);
    try {
      await font.load();
      document.fonts.add(font);
    } catch {
      // Font not available locally — will use CSS fallback
    }

    // Check if the font is actually loaded
    if (document.fonts.check(`16px "${family}"`)) {
      return;
    }

    // Wait for font to be ready
    await document.fonts.ready;
  }

  /** Get the load state of a font family. */
  state(family: string): FontLoadState {
    return this.loadState.get(family) ?? 'unknown';
  }

  /** Check if a font family is loaded and available for use. */
  isAvailable(family: string): boolean {
    return this.loadState.get(family) === 'loaded';
  }

  /** Check if a font family is registered (regardless of load state). */
  isRegistered(family: string): boolean {
    return this.entries.has(family);
  }

  /** Check if a font is missing (not registered and not a generic). */
  isMissing(family: string): boolean {
    const generics = [
      'sans-serif',
      'serif',
      'monospace',
      'system-ui',
      'ui-sans-serif',
      'ui-serif',
      'ui-monospace',
      'fantasy',
      'cursive',
    ];
    if (generics.includes(family.toLowerCase())) return false;
    return !this.entries.has(family);
  }

  /** Resolve font to a CSS font-family fallback chain string. The family name is quoted; generic fallbacks are not. */
  resolve(family: string, _weight?: number, _style?: string): string {
    const fallbacks = this.fallbackChain(family);
    const generics = [
      'sans-serif',
      'serif',
      'monospace',
      'system-ui',
      'ui-sans-serif',
      'ui-serif',
      'ui-monospace',
      'fantasy',
      'cursive',
    ];
    const isGeneric = generics.includes(family.toLowerCase());
    const familyPart = isGeneric ? family : `"${family}"`;
    return fallbacks.length > 0 ? `${familyPart}, ${fallbacks.join(', ')}` : familyPart;
  }

  /** Build a `font` CSS shorthand value from family, size, weight, style, and line-height. */
  buildFontCSS(
    family: string,
    size: number,
    weight?: number,
    style?: string,
    lineHeight?: number,
  ): string {
    const w = weight ?? 400;
    const s = style ?? 'normal';
    const lh = lineHeight ?? 1.2;
    const familyStr = this.resolve(family);
    return `${s} ${w} ${size}px/${lh} ${familyStr}`;
  }

  /** Build font-variation-settings CSS from variableAxes data for a family. */
  buildVariationSettings(family: string): string | undefined {
    const axes = this.getVariableAxes(family);
    if (!axes || Object.keys(axes).length === 0) return undefined;
    const settings = Object.entries(axes)
      .map(([tag, value]) => `"${tag}" ${value}`)
      .join(', ');
    return `font-variation-settings: ${settings};`;
  }

  /** Build font-feature-settings CSS from an OpenType feature map. */
  buildFeatureSettings(features?: Record<string, unknown>): string | undefined {
    if (!features || Object.keys(features).length === 0) return undefined;
    const settings = Object.entries(features)
      .filter(([tag]) => tag !== 'custom')
      .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
      .join(', ');
    const custom = features.custom as Record<string, boolean> | undefined;
    if (custom) {
      const customStr = Object.entries(custom)
        .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
        .join(', ');
      return settings
        ? `font-feature-settings: ${settings}, ${customStr};`
        : `font-feature-settings: ${customStr};`;
    }
    return settings ? `font-feature-settings: ${settings};` : undefined;
  }

  /** Get supported OpenType features for a family (if known). */
  getSupportedFeatures(family: string): string[] {
    const meta = this.metadata.get(family);
    return meta?.openTypeFeatures ?? [];
  }

  /** Register OpenType feature support for a family. */
  registerFeatures(family: string, features: string[]): void {
    const existing = this.metadata.get(family) ?? { family };
    existing.openTypeFeatures = features;
    this.metadata.set(family, existing);
  }

  /** Get font metadata for a family. */
  getMetadata(family: string): FontMetadata | undefined {
    return this.metadata.get(family);
  }

  /** Register metadata for a font family. */
  registerMetadata(meta: FontMetadata): void {
    this.metadata.set(meta.family, meta);
  }

  /** Get all variable font families (those with registered variable axes). */
  variableFamilies(): string[] {
    const result: string[] = [];
    for (const [family, entries] of this.entries) {
      if (entries.some((e) => e.variableAxes)) {
        result.push(family);
      }
    }
    return result.sort();
  }

  /** Check if a family is a variable font. */
  isVariable(family: string): boolean {
    const entries = this.entries.get(family);
    if (!entries) return false;
    return entries.some((e) => e.variableAxes);
  }

  /** Get available font entries as a Set of family names (for preflight). */
  availableFamilies(): Set<string> {
    return new Set(this.entries.keys());
  }

  private metadata: Map<string, FontMetadata> = new Map();
}

/** Font metadata for advanced font management. */
export interface FontMetadata {
  family: string;
  /** PostScript name (for PDF embedding). */
  postScriptName?: string;
  /** Font format (woff2, truetype, opentype, etc.). */
  format?: string;
  /** Font vendor/foundry. */
  vendor?: string;
  /** Font version. */
  version?: string;
  /** Copyright notice. */
  copyright?: string;
  /** License info. */
  license?: string;
  /** Embedding permission from OS/2 fsType. */
  embeddingRights?: import('./font/fontIdentity').EmbeddingRights;
  /** Whether the font contains color glyphs (COLR/CPAL, SVG, sbix, CBDT/CBLC). */
  hasColorGlyphs?: boolean;
  /** Detected colour-font technologies present in the file. */
  colorFormats?: import('./font/fontIdentity').ColorFontFormat[];
  /** Number of colour palettes (CPAL), if present. */
  paletteCount?: number;
  /** Supported OpenType feature tags. */
  openTypeFeatures?: string[];
  /** Supported variable font axes. */
  variableAxisTags?: string[];
  /** Whether the font supports CJK. */
  isCJK?: boolean;
  /** Whether the font supports RTL. */
  isRTL?: boolean;
  /** Number of glyphs. */
  glyphCount?: number;
  /** Units per em (design grid). */
  unitsPerEm?: number;
  /** Ascender value in font units. */
  ascender?: number;
  /** Descender value in font units. */
  descender?: number;
  /** Line gap in font units. */
  lineGap?: number;
  /** x-height in font units. */
  xHeight?: number;
  /** Cap height in font units. */
  capHeight?: number;
}

/** Singleton font registry for the application. */
let globalRegistry: FontRegistry | null = null;

export function getFontRegistry(): FontRegistry {
  if (!globalRegistry) {
    globalRegistry = new FontRegistry();
  }
  return globalRegistry;
}

export function resetFontRegistry(): void {
  globalRegistry = null;
}

export interface ExportFontRequest {
  family: string;
  weight?: number;
  style?: 'normal' | 'italic';
  /** Representative glyphs force the exact face to load before export. */
  text?: string;
}

/**
 * Initiate and await the exact font faces used by an export.
 *
 * `document.fonts.ready` only waits for loads that have already started;
 * unused faces are not implicitly fetched. Calling `FontFaceSet.load()` for
 * each used family/weight/style closes that race while avoiding the old
 * five-second wait for every registered system font.
 */
export async function awaitExportsReady(
  requests: readonly ExportFontRequest[] = [],
): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const registry = getFontRegistry();
  const unique = new Map<string, ExportFontRequest>();
  for (const request of requests) {
    const key = `${request.style ?? 'normal'}:${request.weight ?? 400}:${request.family}`;
    if (!unique.has(key)) unique.set(key, request);
  }

  const loadFaces = [...unique.values()].map(async (request) => {
    await registry.load(request.family);
    const style = request.style ?? 'normal';
    const weight = request.weight ?? 400;
    const descriptor = `${style} ${weight} 16px "${request.family.replaceAll('"', '\\"')}"`;
    await document.fonts.load(descriptor, request.text || 'BESbswy');
  });

  const readiness = Promise.all(loadFaces).then(async () => {
    await document.fonts.ready;
  });
  await Promise.race([
    readiness,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 5000);
    }),
  ]);
}

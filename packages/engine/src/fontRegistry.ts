/**
 * FontRegistry — manages font sources, loading, caching, and fallback chains.
 *
 * Three font sources:
 *   1. System fonts (browser `queryLocalFonts` API or hardcoded safe list)
 *   2. Bundled fonts (@fontsource CSS imports)
 *   3. Google Fonts (optional, via CSS @import)
 *
 * Research basis: CSS Font Loading API, Figma font system, Google Fonts API.
 */

export interface FontEntry {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  source: 'system' | 'bundled' | 'google';
}

export type FontLoadState = 'unknown' | 'loading' | 'loaded' | 'error';

const DEFAULT_FONTS: FontEntry[] = [
  { family: 'Inter', weight: 400, style: 'normal', source: 'bundled' },
  { family: 'Inter', weight: 500, style: 'normal', source: 'bundled' },
  { family: 'Inter', weight: 600, style: 'normal', source: 'bundled' },
  { family: 'Inter', weight: 700, style: 'normal', source: 'bundled' },
  { family: 'Inter', weight: 400, style: 'italic', source: 'bundled' },
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

export class FontRegistry {
  private entries: Map<string, FontEntry[]> = new Map();
  private loaded: Set<string> = new Set();
  private pending: Map<string, Promise<void>> = new Map();

  constructor(initial?: FontEntry[]) {
    for (const entry of initial ?? DEFAULT_FONTS) {
      this.register(entry);
    }
  }

  /** Register a font entry (e.g., from system enumeration or Google Fonts API). */
  register(entry: FontEntry): void {
    const existing = this.entries.get(entry.family) ?? [];
    existing.push(entry);
    this.entries.set(entry.family, existing);
  }

  /** Get all registered font families. */
  families(): string[] {
    return [...this.entries.keys()].sort();
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
    }
  }

  private loadState: Map<string, FontLoadState> = new Map();

  private async doLoad(family: string): Promise<void> {
    if (typeof document === 'undefined') return;
    if (!document.fonts) return;

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

  /** Resolve font to a usable CSS font-family string with fallbacks. */
  resolve(family: string, weight: number, style: string): string {
    const italicPrefix = style === 'italic' ? 'italic ' : '';
    const fallbacks = this.fallbackChain(family).join(', ');
    return `${italicPrefix}${weight} ${family}, ${fallbacks}`;
  }
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

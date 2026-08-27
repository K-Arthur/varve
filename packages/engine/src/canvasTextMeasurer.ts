/**
 * Canvas2D glyph-advance backend for `@varve/shared`'s text measurement.
 *
 * Without this, every text measurement in the application is
 * `text.length * fontSize * 0.6` — the same number for Fraunces as for Arial,
 * and the same number before and after a font loads. That is why a font
 * becoming ready could repaint the canvas and still leave the selection box,
 * hit region, and editing textarea sized for a fallback face: nothing in the
 * geometry path had any dependency on which font was usable.
 *
 * Installing this backend gives every existing `measureText` / `textWrap` /
 * `resolveTextGeometry` caller real advances, and gives them a revision that
 * changes when the usable face set changes, so font-dependent caches can tell
 * that what they hold was measured against a face that is no longer current.
 *
 * The backend declines to install itself in environments whose `measureText`
 * is not a real text shaper (jsdom's stub returns `length * 0.55 * size` for
 * every string). There the estimate is exactly as informative and strictly
 * more predictable, so the estimate is kept.
 */

import {
  setTextAdvanceMeasurer,
  type TextAdvanceMeasurer,
  type TextMeasureOptions,
} from '@varve/shared';

/** Entries are tiny (a number each); this bounds the map, not the memory. */
const MAX_CACHE_ENTRIES = 20000;
/** Strings longer than this are measured but not retained — they rarely repeat. */
const MAX_CACHED_TEXT_LENGTH = 512;

type Ctx2D = {
  font: string;
  measureText(text: string): { width: number };
};

let context: Ctx2D | null | undefined;
let capable: boolean | undefined;
let cache = new Map<string, number>();
let revisionCounter = 0;

function acquireContext(): Ctx2D | null {
  if (context !== undefined) return context;
  context = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d');
      if (ctx) context = ctx as unknown as Ctx2D;
    }
    if (!context && typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) context = ctx as unknown as Ctx2D;
    }
  } catch {
    context = null;
  }
  return context;
}

/**
 * Whether this environment measures glyphs or merely counts characters.
 *
 * A real shaper gives `WWWWWWWWWW` a visibly greater advance than
 * `iiiiiiiiii`; a character-count stub gives them the same. This is a
 * capability probe, not an environment sniff — a headless target with a
 * genuine Canvas2D passes it, and one with a stub is correctly left on the
 * deterministic estimate rather than being fed fabricated numbers.
 */
function isRealTextMeasurement(ctx: Ctx2D): boolean {
  try {
    ctx.font = '100px sans-serif';
    const narrow = ctx.measureText('iiiiiiiiii').width;
    const wide = ctx.measureText('WWWWWWWWWW').width;
    return narrow > 0 && wide > 0 && wide - narrow > 1;
  } catch {
    return false;
  }
}

function fontString(options: TextMeasureOptions): string {
  const style = options.fontStyle === 'italic' ? 'italic ' : '';
  const weight = options.fontWeight ? `${options.fontWeight} ` : '';
  const family = options.fontFamily.includes('"') ? options.fontFamily : `"${options.fontFamily}"`;
  return `${style}${weight}${options.fontSize}px ${family}, sans-serif`;
}

const measurer: TextAdvanceMeasurer = {
  measureAdvance(text: string, options: TextMeasureOptions): number | null {
    if (text.length === 0) return 0;
    const ctx = acquireContext();
    if (!ctx) return null;
    if (capable === undefined) {
      capable = isRealTextMeasurement(ctx);
      if (!capable) {
        // Uninstall rather than answer `null` forever: leaving the backend in
        // place would advertise a font-dependent measurement revision that
        // never actually reflects a font, and every cache keyed on it would
        // invalidate for nothing.
        setTextAdvanceMeasurer(null);
      }
    }
    if (!capable) return null;

    const font = fontString(options);
    // Variation settings change advances on a variable face, and Canvas2D has
    // no way to express them, so they belong in the key: a wght 700 layout
    // must not reuse the wght 400 measurement even though the CSS font
    // shorthand is identical.
    const axes = options.variableAxes ? JSON.stringify(options.variableAxes) : '';
    const key = `${font}|${axes}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    ctx.font = font;
    const width = ctx.measureText(text).width;
    if (!Number.isFinite(width)) return null;
    if (text.length <= MAX_CACHED_TEXT_LENGTH) {
      // Cheap bound: drop the whole map rather than track recency. Text
      // measurement is re-derivable and the working set refills in one frame.
      if (cache.size >= MAX_CACHE_ENTRIES) cache = new Map();
      cache.set(key, width);
    }
    return width;
  },
  revision(): string {
    return `canvas-text:${revisionCounter}`;
  },
};

/**
 * Drop every cached advance and advance the measurement revision.
 *
 * Called when the usable face set changes. A box measured while a family was
 * still falling back must not survive that family becoming usable.
 */
export function invalidateCanvasTextMeasurements(): void {
  cache = new Map();
  revisionCounter += 1;
}

/** Install the backend. Idempotent; the capability probe runs on first use. */
export function installCanvasTextMeasurer(): void {
  setTextAdvanceMeasurer(measurer);
}

/** Test seam: forget the probe result and any acquired context. */
export function resetCanvasTextMeasurer(): void {
  context = undefined;
  capable = undefined;
  cache = new Map();
  revisionCounter += 1;
  setTextAdvanceMeasurer(null);
}

installCanvasTextMeasurer();

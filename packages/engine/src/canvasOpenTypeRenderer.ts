/**
 * Main-thread OpenType fallback for Canvas2D runtimes without feature and
 * variation properties.
 *
 * Canvas2D can expose a font family but still omit `fontFeatureSettings` and
 * `fontVariationSettings`. In that runtime a generated @font-face alias is
 * useful for face selection, but it cannot carry the authored GSUB/GPOS
 * choice into fillText. This module keeps a bounded, process-local cache of
 * parsed source faces and paints feature-bearing runs through opentype.js.
 * The replay path remains synchronous: a run uses Canvas2D while the local
 * source is being fetched/decoded, then the alias-ready notification causes
 * an authoritative repaint with the exact glyph paths.
 */

import type { OpenTypeFeatureMap } from '@varve/shared';
import { type Font, parse as parseOpenType } from 'opentype.js';
import type { ReplayTarget } from './replayTypes';

const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_FONTS = 64;

interface CanvasOpenTypeFontEntry {
  font: Font;
  unicodeRange?: string;
  faceKey?: string;
}

const fontsByAlias = new Map<string, CanvasOpenTypeFontEntry[]>();
const pendingSources = new Map<string, Promise<Font | null>>();

/** Fetch, decode, and parse a CSS `src` expression into a usable OpenType face. */
export async function loadCanvasOpenTypeFont(source: string): Promise<Font | null> {
  const url = extractSourceUrl(source);
  if (!url || typeof fetch !== 'function') return null;
  const cached = pendingSources.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`font source returned ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) {
        throw new Error('font source is empty or exceeds the parser bound');
      }
      return decodeAndParse(bytes);
    })
    .catch(() => null);
  pendingSources.set(url, pending);
  const result = await pending;
  if (!result) pendingSources.delete(url);
  return result;
}

/** Associate a parsed face with the generated alias used by Canvas replay. */
export function registerCanvasOpenTypeFont(
  aliasFamily: string,
  font: Font,
  options: { unicodeRange?: string; faceKey?: string } = {},
): void {
  const entries = fontsByAlias.get(aliasFamily) ?? [];
  const duplicate = entries.some(
    (entry) => entry.font === font && entry.unicodeRange === options.unicodeRange,
  );
  if (!duplicate) entries.push({ font, ...options });
  fontsByAlias.set(aliasFamily, entries);
  while (fontsByAlias.size > MAX_FONTS) {
    const oldest = fontsByAlias.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    fontsByAlias.delete(oldest);
  }
}

/** Remove parsed faces when a generated alias is evicted or reset. */
export function removeCanvasOpenTypeFont(aliasFamily: string): void {
  fontsByAlias.delete(aliasFamily);
}

/** Remove all process-local parsed faces. */
export function resetCanvasOpenTypeFonts(): void {
  fontsByAlias.clear();
  pendingSources.clear();
}

/**
 * Paint a feature-bearing run with real OpenType paths. Returns false when
 * the source face is still loading or cannot be parsed, allowing the caller
 * to use its honest Canvas2D fallback for that frame.
 */
export function drawCanvasOpenTypeText(
  target: ReplayTarget,
  aliasFamily: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  options: {
    features?: OpenTypeFeatureMap;
    variableAxes?: Record<string, number>;
  } = {},
): boolean {
  const entries = fontsByAlias.get(aliasFamily);
  if (!entries || entries.length === 0 || text.length === 0) return false;
  const entry = entries.find((candidate) =>
    candidate.unicodeRange ? textMatchesUnicodeRange(text, candidate.unicodeRange) : true,
  );
  if (!entry) return false;
  const font = entry.font as Font & {
    variation?: { set: (axes: Record<string, number>) => void };
  };
  try {
    if (options.variableAxes && Object.keys(options.variableAxes).length > 0) {
      font.variation?.set(options.variableAxes);
    }
    // opentype.js consumes a tag → boolean map and applies the font's normal
    // script features unless an authored tag explicitly disables/enables one.
    const features = Object.fromEntries(
      Object.entries(options.features ?? {}).map(([tag, value]) => [
        tag,
        value !== false && value !== 0,
      ]),
    );
    font.draw(target as unknown as CanvasRenderingContext2D, text, x, y, fontSize, {
      kerning: true,
      ...(Object.keys(features).length > 0 ? { features } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

function extractSourceUrl(source: string): string | null {
  const match = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(source);
  const value = match?.[2]?.trim();
  if (!value || /^local\(/i.test(value)) return null;
  try {
    return new URL(value, typeof document !== 'undefined' ? document.baseURI : undefined).href;
  } catch {
    return value;
  }
}

async function decodeAndParse(bytes: ArrayBuffer): Promise<Font | null> {
  const view = new DataView(bytes);
  let decoded = bytes;
  const signature = view.getUint32(0, false);
  if (signature === 0x774f4632) {
    const { decompress } = await import('wawoff2');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      decompress(new Uint8Array(bytes)),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), 2_000);
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (!result || result.byteLength === 0 || result.byteLength > MAX_SOURCE_BYTES) return null;
    decoded = result.buffer.slice(
      result.byteOffset,
      result.byteOffset + result.byteLength,
    ) as ArrayBuffer;
  }
  return parseOpenType(decoded);
}

function textMatchesUnicodeRange(text: string, range: string): boolean {
  return Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return range.split(',').some((part) => {
      const value = part.trim().replace(/^U\+/i, '');
      if (!value) return false;
      if (value.includes('?')) {
        const min = Number.parseInt(value.replaceAll('?', '0'), 16);
        const max = Number.parseInt(value.replaceAll('?', 'F'), 16);
        return Number.isFinite(min) && codePoint >= min && codePoint <= max;
      }
      const [startValue, endValue] = value.split('-');
      const start = Number.parseInt(startValue ?? '', 16);
      const end = Number.parseInt(endValue ?? startValue ?? '', 16);
      return (
        Number.isFinite(start) && Number.isFinite(end) && codePoint >= start && codePoint <= end
      );
    });
  });
}

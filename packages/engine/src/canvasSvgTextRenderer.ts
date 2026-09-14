/**
 * Browser fallback for Canvas2D text features.
 *
 * Some WebViews expose neither Canvas2D OpenType feature properties nor a
 * usable WOFF2 decoder. An SVG text image still uses the browser's native
 * shaping engine and accepts the same CSS feature/variation descriptors. The
 * first frame remains the normal Canvas fallback; the decoded image is cached
 * and a ready notification asks the editor for an authoritative repaint.
 */

import { type OpenTypeFeatureMap, openTypeFeaturesToCss } from '@varve/shared';
import type { ReplayTarget } from './replayTypes';

interface CachedSvgText {
  image: HTMLImageElement;
  width: number;
  height: number;
}

export interface CanvasSvgSourceFace {
  source: string;
  weight?: string;
  style?: string;
  stretch?: string;
  unicodeRange?: string;
}

const cache = new Map<string, CachedSvgText>();
const pending = new Map<string, Promise<void>>();
const sourceData = new Map<string, Promise<string | null>>();
const readyListeners = new Set<() => void>();
const MAX_ENTRIES = 64;
let generation = 0;

export function subscribeToCanvasSvgTextReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

export function resetCanvasSvgText(): void {
  generation += 1;
  cache.clear();
  pending.clear();
  sourceData.clear();
}

export function drawCanvasSvgText(
  target: ReplayTarget,
  input: {
    family: string;
    text: string;
    x: number;
    y: number;
    fontSize: number;
    fontWeight: number;
    fontStyle?: string;
    features?: OpenTypeFeatureMap;
    axes?: Record<string, number>;
    sourceFaces?: readonly CanvasSvgSourceFace[];
    fillStyle: unknown;
  },
): boolean {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || !target.drawImage) {
    return false;
  }
  const fillStyle = input.fillStyle;
  if (typeof fillStyle !== 'string' || input.text.length === 0) return false;
  if (!input.sourceFaces || input.sourceFaces.length === 0) return false;
  const featureSettings = openTypeFeaturesToCss(input.features);
  const variationSettings = variationCss(input.axes);
  if (!featureSettings && !variationSettings) return false;
  const key = [
    input.family,
    input.text,
    input.fontSize,
    input.fontWeight,
    input.fontStyle ?? 'normal',
    featureSettings ?? '',
    variationSettings ?? '',
    input.sourceFaces.map(serializeSourceFace).join('|'),
    fillStyle,
  ].join('\u0000');
  const ready = cache.get(key);
  if (ready) {
    target.drawImage(ready.image, input.x, input.y - input.fontSize);
    return true;
  }
  if (!pending.has(key)) {
    pending.set(
      key,
      loadSvgText(
        key,
        { ...input, fillStyle, sourceFaces: input.sourceFaces },
        featureSettings,
        variationSettings,
        generation,
      ),
    );
  }
  return false;
}

async function loadSvgText(
  key: string,
  input: {
    family: string;
    text: string;
    fontSize: number;
    fontWeight: number;
    fontStyle?: string;
    features?: OpenTypeFeatureMap;
    axes?: Record<string, number>;
    sourceFaces: readonly CanvasSvgSourceFace[];
    fillStyle: string;
  },
  featureSettings: string | undefined,
  variationSettings: string | undefined,
  loadGeneration: number,
): Promise<void> {
  try {
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure) return;
    measure.font = `${input.fontStyle === 'italic' ? 'italic ' : ''}${input.fontWeight} ${input.fontSize}px "${input.family.replaceAll('"', '\\"')}"`;
    const width = Math.max(1, Math.ceil(measure.measureText(input.text).width + input.fontSize));
    const height = Math.max(1, Math.ceil(input.fontSize * 1.5));
    const family = 'VarveSvgFont';
    const text = escapeXml(input.text);
    const fill = escapeXml(input.fillStyle);
    const rawStyle = [
      `font-family:${family}`,
      `font-size:${input.fontSize}px`,
      `font-weight:${input.fontWeight}`,
      `font-style:${input.fontStyle === 'italic' ? 'italic' : 'normal'}`,
      `fill:${fill}`,
      featureSettings ? `font-feature-settings:${featureSettings}` : '',
      variationSettings ? `font-variation-settings:${variationSettings}` : '',
    ]
      .filter(Boolean)
      .join(';');
    const style = escapeXml(rawStyle);
    const embeddedFaces = (
      await Promise.all(
        input.sourceFaces.map(async (face) => {
          const source = await inlineSource(face.source);
          if (!source) return '';
          const descriptors = [
            `font-family:${family}`,
            `src:${source}`,
            face.weight ? `font-weight:${face.weight}` : '',
            face.style ? `font-style:${face.style}` : '',
            face.stretch ? `font-stretch:${face.stretch}` : '',
            face.unicodeRange ? `unicode-range:${face.unicodeRange}` : '',
          ]
            .filter(Boolean)
            .join(';');
          return `@font-face{${descriptors}}`;
        }),
      )
    )
      .filter(Boolean)
      .join('');
    if (!embeddedFaces) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style><![CDATA[${embeddedFaces}]]></style><text x="0" y="${input.fontSize}" style="${style}">${text}</text></svg>`;
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG typography image failed to load'));
      image.src = url;
    });
    URL.revokeObjectURL(url);
    if (loadGeneration !== generation) return;
    cache.set(key, { image, width, height });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    for (const listener of readyListeners) listener();
  } catch {
    // Canvas2D remains the explicit fallback when SVG text is unavailable.
  } finally {
    if (loadGeneration === generation) pending.delete(key);
  }
}

function variationCss(axes?: Record<string, number>): string | undefined {
  const values = Object.entries(axes ?? {})
    .filter(([tag, value]) => /^[A-Za-z]{4}$/.test(tag) && Number.isFinite(value))
    .sort(([a], [b]) => a.localeCompare(b));
  if (values.length === 0) return undefined;
  return values.map(([tag, value]) => `"${tag}" ${value}`).join(',');
}

function serializeSourceFace(face: CanvasSvgSourceFace): string {
  return [face.source, face.weight, face.style, face.stretch, face.unicodeRange].join('|');
}

async function inlineSource(source: string): Promise<string | null> {
  const match = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(source);
  const value = match?.[2]?.trim();
  if (!value || /^data:/i.test(value)) return value ? source : null;
  const existing = sourceData.get(value);
  if (existing) return existing;
  const pendingSource = fetch(value)
    .then(async (response) => {
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > 128 * 1024 * 1024) return null;
      const base64 = bytesToBase64(new Uint8Array(bytes));
      const format = /format\(\s*["']?([^"')\s]+)["']?\s*\)/i.exec(source)?.[1]?.toLowerCase();
      const mime =
        format === 'woff2'
          ? 'font/woff2'
          : format === 'woff'
            ? 'font/woff'
            : format === 'opentype'
              ? 'font/otf'
              : 'font/ttf';
      return `url("data:${mime};base64,${base64}")`;
    })
    .catch(() => null);
  sourceData.set(value, pendingSource);
  return pendingSource;
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(result);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Backend-neutral OpenType shaping contract.
 *
 * The live renderer may use Canvas2D as a bounded fallback, but production
 * layout needs a backend that returns real glyph IDs, positions, and source
 * clusters. Native rustybuzz and web HarfBuzz use this normalized contract so
 * downstream layout code does not depend on either IPC or Emscripten types.
 */

import type { OpenTypeFeatureMap, ShapedGlyph } from './types';
import { createUnicodeIndexMap } from './unicode/unicodeIndices';

export interface ShapingBackendRequest {
  text: string;
  fontData: ArrayBuffer;
  faceIndex?: number;
  fontSize: number;
  language?: string;
  script?: string;
  direction?: 'ltr' | 'rtl' | 'ttb' | 'btt';
  features?: OpenTypeFeatureMap;
  variationAxes?: Record<string, number>;
}

export interface ShapingBackendResult {
  glyphs: ShapedGlyph[];
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  direction: 'ltr' | 'rtl' | 'ttb' | 'btt';
  script?: string;
  language?: string;
  missingGlyphIndices: number[];
  warnings: string[];
  backend: 'harfbuzz-wasm' | 'rustybuzz-native';
}

export interface ShapingBackend {
  readonly kind: ShapingBackendResult['backend'];
  shape(request: ShapingBackendRequest): Promise<ShapingBackendResult>;
}

export interface NativeShapedRunPayload {
  glyphs: Array<{
    glyph_id: number;
    x_advance: number;
    y_advance: number;
    x_offset: number;
    y_offset: number;
    cluster: number;
  }>;
  direction: string;
  script: string;
  language?: string;
  missing_glyph_indices?: number[];
  warnings?: string[];
  units_per_em?: number;
  ascent?: number;
  descent?: number;
  line_gap?: number;
}

/** Convert the native wire response into the browser-facing shape contract. */
export function normalizeNativeShapedRun(
  payload: NativeShapedRunPayload,
  text: string,
  fontSize: number,
): ShapingBackendResult {
  const unitsPerEm = positiveOr(payload.units_per_em, 1000);
  const scale = fontSize / unitsPerEm;
  return {
    glyphs: payload.glyphs.map((glyph) => ({
      glyphId: glyph.glyph_id,
      xAdvance: glyph.x_advance * scale,
      yAdvance: glyph.y_advance * scale,
      xOffset: glyph.x_offset * scale,
      yOffset: glyph.y_offset * scale,
      clusterUtf16: clampCluster(glyph.cluster, text.length),
    })),
    unitsPerEm,
    ascent: positiveOr(payload.ascent, unitsPerEm * 0.8) * scale,
    descent: positiveOr(payload.descent, unitsPerEm * 0.2) * scale,
    lineGap: Math.max(0, payload.line_gap ?? 0) * scale,
    direction: normalizeDirection(payload.direction),
    script: payload.script,
    language: payload.language,
    missingGlyphIndices:
      payload.missing_glyph_indices ??
      payload.glyphs.flatMap((glyph, index) => (glyph.glyph_id === 0 ? [index] : [])),
    warnings: payload.warnings ?? [],
    backend: 'rustybuzz-native',
  };
}

/**
 * Shape with the bundled HarfBuzz WASM package. Initialization is lazy so the
 * engine remains usable in SSR/tests and does not transfer font bytes until a
 * real shaping request is made.
 */
export function createHarfBuzzWasmBackend(): ShapingBackend {
  let modulePromise: Promise<typeof import('harfbuzzjs')> | undefined;
  return {
    kind: 'harfbuzz-wasm',
    async shape(request) {
      modulePromise ??= import('harfbuzzjs');
      const hb = await modulePromise;
      const blob = new hb.Blob(request.fontData);
      const face = new hb.Face(blob, request.faceIndex ?? 0);
      const font = new hb.Font(face);
      const map = createUnicodeIndexMap(request.text);
      font.setScale(request.fontSize, request.fontSize);
      if (request.variationAxes && Object.keys(request.variationAxes).length > 0) {
        font.setVariations(
          Object.entries(request.variationAxes).map(([tag, value]) => new hb.Variation(tag, value)),
        );
      }

      const buffer = new hb.Buffer();
      for (
        let codePointIndex = 0;
        codePointIndex < map.codePointBoundaries.length - 1;
        codePointIndex++
      ) {
        const start = map.codePointBoundaries[codePointIndex]!;
        const codePoint = request.text.codePointAt(start);
        if (codePoint !== undefined) buffer.add(codePoint, start);
      }
      // Infer direction/script/language from the text first, then apply the
      // explicit request fields — without the guess, a direction-only request
      // shapes with the default script (no Arabic/Indic features).
      buffer.guessSegmentProperties();
      if (request.direction)
        buffer.setDirection(directionToHarfBuzz(hb.Direction, request.direction));
      if (request.script) buffer.setScript(request.script);
      if (request.language) buffer.setLanguage(request.language);
      buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_CHARACTERS);

      const features = featureList(hb.Feature, request.features);
      hb.shape(font, buffer, features);
      const infos = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();
      const extents = font.hExtents();
      const glyphs = infos.map((info, index) => {
        const position = positions[index]!;
        return {
          glyphId: info.codepoint,
          xAdvance: position.xAdvance,
          yAdvance: position.yAdvance,
          xOffset: position.xOffset,
          yOffset: position.yOffset,
          clusterUtf16: clampCluster(info.cluster, request.text.length),
        } satisfies ShapedGlyph;
      });
      return {
        glyphs,
        unitsPerEm: face.upem,
        ascent: extents.ascender,
        descent: Math.abs(extents.descender),
        lineGap: extents.lineGap,
        direction: request.direction ?? 'ltr',
        script: request.script,
        language: request.language,
        missingGlyphIndices: glyphs.flatMap((glyph, index) => (glyph.glyphId === 0 ? [index] : [])),
        warnings: [],
        backend: 'harfbuzz-wasm',
      };
    },
  };
}

function featureList(
  Feature: typeof import('harfbuzzjs').Feature,
  features?: OpenTypeFeatureMap,
): Array<InstanceType<typeof Feature>> {
  if (!features) return [];
  const entries = Object.entries(features).filter(([tag]) => tag !== 'custom');
  if (features.custom) entries.push(...Object.entries(features.custom));
  return entries.flatMap(([tag, enabled]) => {
    if (typeof enabled !== 'boolean' || tag.length !== 4) return [];
    return [new Feature(tag, enabled ? 1 : 0)];
  });
}

function directionToHarfBuzz(
  directions: typeof import('harfbuzzjs').Direction,
  direction: NonNullable<ShapingBackendRequest['direction']>,
): import('harfbuzzjs').Direction {
  return direction === 'rtl'
    ? directions.RTL
    : direction === 'ttb'
      ? directions.TTB
      : direction === 'btt'
        ? directions.BTT
        : directions.LTR;
}

function normalizeDirection(direction: string): ShapingBackendResult['direction'] {
  if (direction === 'rtl' || direction === 'ttb' || direction === 'btt') return direction;
  return 'ltr';
}

function clampCluster(cluster: number, textLength: number): number {
  return Math.min(Math.max(0, Math.trunc(cluster)), textLength);
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? value : fallback;
}

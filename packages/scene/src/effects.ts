/**
 * Canonical effect normalization — stable identifiers and parameter
 * validation for the scene Effect model.
 *
 * Effects are discriminated unions stored on nodes (`node.effects`). Two
 * concerns live here so the rest of the app can trust the model:
 *
 *  - **Stable IDs**: every effect gets an `id` so the inspector can key rows
 *    by identity (reorder-safe), and so effect styles / clipboard copies keep
 *    a stable reference. IDs are assigned lazily at document load; effects
 *    created by the UI are created with an ID already set.
 *  - **Parameter validation**: malformed documents (NaN, Infinity, negative
 *    blur) are clamped to safe values instead of producing NaN canvases or
 *    giant allocations downstream.
 *
 * Research basis: discriminated-union effect models in Figma/Sketch/Penpot;
 * defensive normalisation of third-party or version-migrated documents.
 */

import type { Document } from './document';
import { cryptoId } from './document-utils';
import type {
  ChannelOffset,
  ChromaticChannelSource,
  ChromaticContribution,
  Effect,
  SceneNode,
} from './types';

/** Deterministic fallback when crypto is unavailable. */
function effectId(): string {
  return cryptoId();
}

/**
 * Nodes whose own rendered result has a meaningful Layer Effects stage.
 * Adjustment nodes deliberately stay out: their rendered scope is owned by
 * the adjustment pipeline, not by an invented zero-size silhouette.
 */
export function canHaveLayerEffects(
  node: SceneNode,
): node is Exclude<SceneNode, { kind: 'adjustment' }> {
  // Raster layers may still arrive from legacy documents without the field;
  // normalization supplies the empty array, but capability checks must remain
  // true before that compatibility pass runs.
  return node.kind !== 'adjustment' && (node.kind === 'rasterLayer' || 'effects' in node);
}

/** Canonical authored defaults for a new layer appearance effect. */
export function createDefaultEffect(type: Effect['type'], id = effectId()): Effect {
  switch (type) {
    case 'dropShadow':
      return {
        id,
        type,
        x: 0,
        y: 4,
        blur: 8,
        spread: 0,
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 76 },
        opacity: 0.3,
        blendMode: 'normal',
        visible: true,
      };
    case 'innerShadow':
      return {
        id,
        type,
        x: 0,
        y: 2,
        blur: 4,
        spread: 0,
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 38 },
        opacity: 0.25,
        blendMode: 'normal',
        visible: true,
      };
    case 'layerBlur':
      return { id, type, radius: 4, visible: true };
    case 'backgroundBlur':
      return { id, type, radius: 8, visible: true };
    case 'depthBlur':
      return {
        id,
        type,
        depthMapId: '',
        focusDepth: 0.5,
        focusRange: 0.2,
        blurStrength: 12,
        falloff: 1,
        invert: false,
        edgeProtection: 0.035,
        visible: true,
      };
    case 'outerGlow':
      return {
        id,
        type,
        blur: 6,
        spread: 0,
        colorMode: 'solid',
        choke: 0,
        contour: 'smooth',
        color: { space: 'rgb', r: 255, g: 200, b: 100, a: 128 },
        opacity: 0.6,
        blendMode: 'screen',
        visible: true,
      };
    case 'innerGlow':
      return {
        id,
        type,
        blur: 6,
        spread: 0,
        colorMode: 'solid',
        choke: 0,
        contour: 'smooth',
        origin: 'edge',
        color: { space: 'rgb', r: 255, g: 200, b: 100, a: 128 },
        opacity: 0.6,
        blendMode: 'screen',
        visible: true,
      };
    case 'glassMaterial':
      return {
        id,
        type,
        blur: 12,
        tint: { space: 'rgb', r: 200, g: 220, b: 255, a: 60 },
        tintOpacity: 0.3,
        saturation: 1.2,
        brightness: 1.05,
        noise: 0.02,
        edgeHighlight: true,
        edgeHighlightWidth: 1.5,
        edgeHighlightColor: { space: 'rgb', r: 255, g: 255, b: 255, a: 120 },
        edgeHighlightOpacity: 0.4,
        visible: true,
      };
    case 'chromaticAberration':
      return {
        id,
        type,
        offsets: { redX: 3, redY: 0, greenX: 0, greenY: 0, blueX: -3, blueY: 0 },
        channelColors: {
          red: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          green: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
          blue: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
        },
        channelMode: 'rgb',
        customChannels: [
          {
            id: 'red',
            enabled: true,
            source: 'red',
            color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
            strength: 1,
            x: 3,
            y: 0,
          },
          {
            id: 'green',
            enabled: true,
            source: 'green',
            color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
            strength: 1,
            x: 0,
            y: 0,
          },
          {
            id: 'blue',
            enabled: true,
            source: 'blue',
            color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
            strength: 1,
            x: -3,
            y: 0,
          },
        ],
        intensity: 1,
        mix: 1,
        blendMode: 'normal',
        opacity: 1,
        visible: true,
      };
    case 'glitch':
      return {
        id,
        type,
        seed: 42,
        strength: 8,
        density: 0.3,
        sliceHeight: 8,
        blockCount: 5,
        blockSize: 20,
        blockStrength: 10,
        noiseIntensity: 0.05,
        scanlineIntensity: 0.15,
        scanlineSpacing: 4,
        direction: 'horizontal',
        channelShift: { redX: 0, redY: 0, greenX: 0, greenY: 0, blueX: 0, blueY: 0 },
        channelShiftMode: 'static',
        blendMode: 'normal',
        opacity: 1,
        visible: true,
      };
  }
}

/** Coerce a value to a finite number within [min, max], or `fallback`. */
function clampNum(v: unknown, fallback: number, min = 0, max = 4096): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** True when an effect already carries an id and all listed params are finite. */
function isCleanEffect(e: Record<string, unknown>, params: readonly string[]): boolean {
  if (typeof e.id !== 'string' || e.id.length === 0) return false;
  for (const key of params) {
    const v = e[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  return true;
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

const ZERO_CHANNEL_OFFSET: ChannelOffset = {
  redX: 0,
  redY: 0,
  greenX: 0,
  greenY: 0,
  blueX: 0,
  blueY: 0,
};

function isCleanChannelOffset(value: unknown): value is ChannelOffset {
  if (!value || typeof value !== 'object') return false;
  const offset = value as Record<string, unknown>;
  return ['redX', 'redY', 'greenX', 'greenY', 'blueX', 'blueY'].every((key) =>
    inRange(offset[key], -4096, 4096),
  );
}

function normalizeChannelOffset(value: unknown, fallback = ZERO_CHANNEL_OFFSET): ChannelOffset {
  const offset = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    redX: clampNum(offset.redX, fallback.redX, -4096, 4096),
    redY: clampNum(offset.redY, fallback.redY, -4096, 4096),
    greenX: clampNum(offset.greenX, fallback.greenX, -4096, 4096),
    greenY: clampNum(offset.greenY, fallback.greenY, -4096, 4096),
    blueX: clampNum(offset.blueX, fallback.blueX, -4096, 4096),
    blueY: clampNum(offset.blueY, fallback.blueY, -4096, 4096),
  };
}

const CHROMATIC_SOURCES: readonly ChromaticChannelSource[] = [
  'red',
  'green',
  'blue',
  'luminance',
  'alpha',
];

function normalizeChromaticChannels(value: unknown): ChromaticContribution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 8).map((entry, index) => {
    const candidate = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const source = CHROMATIC_SOURCES.includes(candidate.source as ChromaticChannelSource)
      ? (candidate.source as ChromaticChannelSource)
      : 'alpha';
    return {
      ...(typeof candidate.id === 'string' && candidate.id.length > 0
        ? { id: candidate.id }
        : { id: `contribution-${index + 1}` }),
      enabled: candidate.enabled !== false,
      source,
      color:
        candidate.color && typeof candidate.color === 'object'
          ? (candidate.color as ChromaticContribution['color'])
          : { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strength: clampNum(candidate.strength, 1, 0, 2),
      x: clampNum(candidate.x, 0, -4096, 4096),
      y: clampNum(candidate.y, 0, -4096, 4096),
    };
  });
}

function normalizeEffectGradient(
  value: unknown,
): { stops: Array<{ position: number; color: ChromaticContribution['color'] }> } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const stops = (value as { stops?: unknown }).stops;
  if (!Array.isArray(stops) || stops.length === 0) return undefined;
  return {
    stops: stops.slice(0, 8).map((entry, index) => {
      const candidate =
        entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return {
        position: clampNum(candidate.position, index / Math.max(1, stops.length - 1), 0, 1),
        color:
          candidate.color && typeof candidate.color === 'object'
            ? (candidate.color as ChromaticContribution['color'])
            : { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      };
    }),
  };
}

function normalizedId(id: unknown): string {
  return typeof id === 'string' && id.length > 0 ? id : effectId();
}

/** Deterministic identity for an effect that came from a legacy document. */
function legacyEffectId(nodeId: string, index: number): string {
  return `fx-${nodeId}-${index + 1}`;
}

/** Assign an `id` to an effect if it lacks one. */
export function ensureEffectId(effect: Effect): Effect {
  if (typeof effect.id === 'string' && effect.id.length > 0) return effect;
  return { ...effect, id: effectId() };
}

/** Normalize the parameters of an effect, guarding against malformed values. */
export function normalizeEffectParams(effect: Effect): Effect {
  const e = effect as Effect & Record<string, unknown>;
  switch (e.type) {
    case 'dropShadow':
    case 'innerShadow': {
      if (
        isCleanEffect(e, ['x', 'y', 'blur', 'spread', 'opacity']) &&
        inRange(e.x, -4096, 4096) &&
        inRange(e.y, -4096, 4096) &&
        inRange(e.blur, 0, 4096) &&
        inRange(e.spread, -2048, 2048) &&
        inRange(e.opacity, 0, 1)
      )
        return effect;
      return {
        ...e,
        id: normalizedId(e.id),
        x: clampNum(e.x, 0, -4096, 4096),
        y: clampNum(e.y, 0, -4096, 4096),
        blur: clampNum(e.blur, 0),
        spread: clampNum(e.spread, 0, -2048, 2048),
        opacity: clampNum(e.opacity, 1, 0, 1),
      } as Effect;
    }
    case 'outerGlow':
    case 'innerGlow': {
      const gradient = normalizeEffectGradient(e.gradient);
      if (
        isCleanEffect(e, ['blur', 'spread', 'opacity']) &&
        inRange(e.blur, 0, 4096) &&
        inRange(e.spread, -2048, 2048) &&
        inRange(e.opacity, 0, 1) &&
        (e.choke === undefined || inRange(e.choke, 0, 1)) &&
        (e.contour === undefined ||
          e.contour === 'linear' ||
          e.contour === 'smooth' ||
          e.contour === 'sharp') &&
        (e.type !== 'innerGlow' ||
          e.origin === undefined ||
          e.origin === 'edge' ||
          e.origin === 'center') &&
        (e.gradient === undefined || gradient !== undefined) &&
        (e.colorMode === undefined || e.colorMode === 'solid' || e.colorMode === 'gradient')
      )
        return effect;
      return {
        ...e,
        id: normalizedId(e.id),
        blur: clampNum(e.blur, 0),
        spread: clampNum(e.spread, 0, -2048, 2048),
        choke: clampNum(e.choke, 0, 0, 1),
        contour: e.contour === 'linear' || e.contour === 'sharp' ? e.contour : 'smooth',
        colorMode: e.colorMode === 'gradient' ? 'gradient' : 'solid',
        ...(gradient ? { gradient } : {}),
        ...(e.type === 'innerGlow' ? { origin: e.origin === 'center' ? 'center' : 'edge' } : {}),
        opacity: clampNum(e.opacity, 1, 0, 1),
      } as Effect;
    }
    case 'layerBlur':
    case 'backgroundBlur': {
      if (isCleanEffect(e, ['radius']) && inRange(e.radius, 0, 4096)) return effect;
      return {
        ...e,
        id: normalizedId(e.id),
        radius: clampNum(e.radius, 0),
      } as Effect;
    }
    case 'depthBlur': {
      if (
        typeof e.depthMapId === 'string' &&
        isCleanEffect(e, [
          'focusDepth',
          'focusRange',
          'blurStrength',
          'falloff',
          'edgeProtection',
        ]) &&
        inRange(e.focusDepth, 0, 1) &&
        inRange(e.focusRange, 0, 1) &&
        inRange(e.blurStrength, 0, 4096) &&
        inRange(e.falloff, 0, 1) &&
        inRange(e.edgeProtection, 0, 1)
      )
        return effect;
      return {
        ...e,
        id: normalizedId(e.id),
        depthMapId: typeof e.depthMapId === 'string' ? e.depthMapId : '',
        focusDepth: clampNum(e.focusDepth, 0.5, 0, 1),
        focusRange: clampNum(e.focusRange, 0.2, 0, 1),
        blurStrength: clampNum(e.blurStrength, 12, 0, 4096),
        falloff: clampNum(e.falloff, 0.5, 0, 1),
        invert: e.invert === true,
        edgeProtection: clampNum(e.edgeProtection, 0.035, 0, 1),
      } as Effect;
    }
    case 'glassMaterial': {
      if (
        isCleanEffect(e, [
          'blur',
          'tintOpacity',
          'saturation',
          'brightness',
          'noise',
          'edgeHighlightWidth',
          'edgeHighlightOpacity',
        ]) &&
        inRange(e.blur, 0, 4096) &&
        inRange(e.tintOpacity, 0, 1) &&
        inRange(e.saturation, 0, 4) &&
        inRange(e.brightness, 0, 4) &&
        inRange(e.noise, 0, 1) &&
        inRange(e.edgeHighlightWidth, 0, 256) &&
        inRange(e.edgeHighlightOpacity, 0, 1)
      )
        return effect;
      return {
        ...e,
        id: normalizedId(e.id),
        blur: clampNum(e.blur, 0),
        tintOpacity: clampNum(e.tintOpacity, 0.3, 0, 1),
        saturation: clampNum(e.saturation, 1, 0, 4),
        brightness: clampNum(e.brightness, 1, 0, 4),
        noise: clampNum(e.noise, 0, 0, 1),
        edgeHighlightWidth: clampNum(e.edgeHighlightWidth, 1, 0, 256),
        edgeHighlightOpacity: clampNum(e.edgeHighlightOpacity, 0.4, 0, 1),
      } as Effect;
    }
    case 'chromaticAberration': {
      const channelMode = e.channelMode === 'custom' ? 'custom' : 'rgb';
      const customChannels = normalizeChromaticChannels(e.customChannels);
      if (
        isCleanEffect(e, ['intensity', 'opacity']) &&
        inRange(e.intensity, 0, 64) &&
        inRange(e.opacity, 0, 1) &&
        isCleanChannelOffset(e.offsets) &&
        (e.mix === undefined || inRange(e.mix, 0, 1)) &&
        (e.channelMode === undefined || e.channelMode === 'rgb' || e.channelMode === 'custom') &&
        (e.customChannels === undefined || customChannels !== undefined)
      ) {
        return effect;
      }
      return {
        ...e,
        id: normalizedId(e.id),
        offsets: normalizeChannelOffset(e.offsets, {
          redX: 3,
          redY: 0,
          greenX: 0,
          greenY: 0,
          blueX: -3,
          blueY: 0,
        }),
        intensity: clampNum(e.intensity, 1, 0, 64),
        channelMode,
        ...(customChannels ? { customChannels } : {}),
        mix: clampNum(e.mix, 1, 0, 1),
        opacity: clampNum(e.opacity, 1, 0, 1),
      } as Effect;
    }
    case 'glitch': {
      if (
        isCleanEffect(e, [
          'seed',
          'strength',
          'density',
          'sliceHeight',
          'blockCount',
          'blockSize',
          'blockStrength',
          'noiseIntensity',
          'scanlineIntensity',
          'scanlineSpacing',
          'opacity',
        ]) &&
        inRange(e.seed, 0, 999999) &&
        inRange(e.strength, 0, 4096) &&
        inRange(e.density, 0, 1) &&
        inRange(e.sliceHeight, 1, 4096) &&
        inRange(e.blockCount, 0, 4096) &&
        inRange(e.blockSize, 1, 4096) &&
        inRange(e.blockStrength, 0, 4096) &&
        inRange(e.noiseIntensity, 0, 1) &&
        inRange(e.scanlineIntensity, 0, 1) &&
        inRange(e.scanlineSpacing, 1, 4096) &&
        inRange(e.opacity, 0, 1) &&
        isCleanChannelOffset(e.channelShift) &&
        (e.direction === 'horizontal' || e.direction === 'vertical' || e.direction === 'both') &&
        (e.channelShiftMode === 'static' || e.channelShiftMode === 'seeded')
      )
        return effect;
      return {
        ...e,
        id: normalizedId(e.id),
        seed: clampNum(e.seed, 42, 0, 999999),
        strength: clampNum(e.strength, 8, 0, 4096),
        density: clampNum(e.density, 0.3, 0, 1),
        sliceHeight: clampNum(e.sliceHeight, 8, 1, 4096),
        blockCount: clampNum(e.blockCount, 5, 0, 4096),
        blockSize: clampNum(e.blockSize, 20, 1, 4096),
        blockStrength: clampNum(e.blockStrength, 10, 0, 4096),
        noiseIntensity: clampNum(e.noiseIntensity, 0.05, 0, 1),
        scanlineIntensity: clampNum(e.scanlineIntensity, 0.15, 0, 1),
        scanlineSpacing: clampNum(e.scanlineSpacing, 4, 1, 4096),
        direction:
          e.direction === 'horizontal' || e.direction === 'vertical' || e.direction === 'both'
            ? e.direction
            : 'horizontal',
        channelShift: normalizeChannelOffset(e.channelShift),
        channelShiftMode: e.channelShiftMode === 'seeded' ? 'seeded' : 'static',
        opacity: clampNum(e.opacity, 1, 0, 1),
      } as Effect;
    }
    default:
      return ensureEffectId(effect);
  }
}

/** Assign stable IDs to every effect on a node (returns a new node). */
export function normalizeNodeEffects(node: SceneNode): SceneNode {
  // Raster layers were introduced before Layer Effects became a first-class
  // field. Materialise the empty stack while loading so legacy documents and
  // newly-created raster layers follow the same edit path.
  if (node.kind === 'rasterLayer' && !Array.isArray(node.effects)) {
    return { ...node, effects: [] };
  }
  if (!('effects' in node) || !Array.isArray(node.effects)) return node;
  let changed = false;
  const seenIds = new Set<string>();
  const effects = (node.effects as Effect[]).map((effect, index) => {
    const originalId = effect.id;
    let normalized = normalizeEffectParams(effect);
    const id = normalized.id;
    if (!originalId || !id || seenIds.has(id)) {
      let replacement = legacyEffectId(node.id, index);
      let suffix = 2;
      while (seenIds.has(replacement)) {
        replacement = `${legacyEffectId(node.id, index)}-${suffix++}`;
      }
      normalized = { ...normalized, id: replacement };
    }
    seenIds.add(normalized.id as string);
    if (normalized !== effect) changed = true;
    return normalized;
  });
  if (!changed) return node;
  return { ...node, effects } as SceneNode;
}

/** Assign stable IDs to every effect in a document (immutable). */
export function normalizeDocumentEffects(doc: Document): Document {
  let changed = false;
  const nodes: Document['nodes'] = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    const normalized = normalizeNodeEffects(node);
    if (normalized !== node) changed = true;
    nodes[id] = normalized;
  }
  if (!changed) return doc;
  return { ...doc, nodes };
}

/**
 * Clone a layer-effect stack without sharing nested parameter objects or
 * effect identity. A copied stack must be independently reorderable and
 * editable on its destination node, so each entry receives a fresh id.
 *
 * Effects use a JSON-compatible document wire contract. The shallow fallback
 * preserves a best-effort copy for a future effect whose parameters are not
 * yet understood by this version of the editor.
 */
export function cloneEffects(effects: readonly Effect[]): Effect[] {
  return effects.map((effect) => {
    let copy: Effect;
    try {
      copy = JSON.parse(JSON.stringify(effect)) as Effect;
    } catch {
      copy = { ...effect } as Effect;
    }
    return { ...copy, id: effectId() };
  });
}

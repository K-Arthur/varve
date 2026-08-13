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
import type { ChannelOffset, Effect, SceneNode } from './types';

/** Deterministic fallback when crypto is unavailable. */
function effectId(): string {
  return cryptoId();
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
      if (
        isCleanEffect(e, ['blur', 'spread', 'opacity']) &&
        inRange(e.blur, 0, 4096) &&
        inRange(e.spread, -2048, 2048) &&
        inRange(e.opacity, 0, 1)
      )
        return effect;
      return {
        ...e,
        id: normalizedId(e.id),
        blur: clampNum(e.blur, 0),
        spread: clampNum(e.spread, 0, -2048, 2048),
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
      if (
        isCleanEffect(e, ['intensity', 'opacity']) &&
        inRange(e.intensity, 0, 64) &&
        inRange(e.opacity, 0, 1) &&
        isCleanChannelOffset(e.offsets)
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

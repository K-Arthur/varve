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
import type { Effect, SceneNode } from './types';

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
      if (isCleanEffect(e, ['x', 'y', 'blur', 'spread', 'opacity'])) return effect;
      return {
        ...e,
        id: typeof e.id === 'string' ? e.id : effectId(),
        x: clampNum(e.x, 0, -4096, 4096),
        y: clampNum(e.y, 0, -4096, 4096),
        blur: clampNum(e.blur, 0),
        spread: clampNum(e.spread, 0, -2048, 2048),
        opacity: clampNum(e.opacity, 1, 0, 1),
      } as Effect;
    }
    case 'outerGlow':
    case 'innerGlow': {
      if (isCleanEffect(e, ['blur', 'spread', 'opacity'])) return effect;
      return {
        ...e,
        id: typeof e.id === 'string' ? e.id : effectId(),
        blur: clampNum(e.blur, 0),
        spread: clampNum(e.spread, 0, -2048, 2048),
        opacity: clampNum(e.opacity, 1, 0, 1),
      } as Effect;
    }
    case 'layerBlur':
    case 'backgroundBlur': {
      if (isCleanEffect(e, ['radius'])) return effect;
      return {
        ...e,
        id: typeof e.id === 'string' ? e.id : effectId(),
        radius: clampNum(e.radius, 0),
      } as Effect;
    }
    case 'glassMaterial': {
      if (isCleanEffect(e, ['blur', 'tintOpacity'])) return effect;
      return {
        ...e,
        id: typeof e.id === 'string' ? e.id : effectId(),
        blur: clampNum(e.blur, 0),
        tintOpacity: clampNum(e.tintOpacity, 1, 0, 1),
      } as Effect;
    }
    case 'chromaticAberration':
    case 'glitch': {
      if (isCleanEffect(e, ['opacity'])) return effect;
      return {
        ...e,
        id: typeof e.id === 'string' ? e.id : effectId(),
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
  const effects = (node.effects as Effect[]).map((effect) => {
    let normalized = normalizeEffectParams(effect);
    const id = normalized.id;
    if (!id || seenIds.has(id)) {
      normalized = { ...normalized, id: effectId() };
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

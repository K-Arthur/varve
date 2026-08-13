/**
 * Proof transform applied to render IR before canvas replay (display only).
 *
 * Applies the proof transform to every color-bearing field of a RenderItem:
 * fills, gradient stops, strokes, effects, and rich-text run colors. The
 * result is used exclusively for on-canvas preview; exports never pass
 * through this module and document colors are never mutated.
 *
 * When proofing is unavailable (no profile converter registered for the
 * runtime), the IR is returned unchanged and callers are expected to
 * disclose the limitation.
 */

import type { RenderItem } from '@varve/engine';
import {
  applyProofToNormalized,
  applyProofToRgba,
  managedColorToNormalized,
  managedColorToRgba,
  type ProofTransformConfig,
} from '@varve/shared';

function proofColor(
  color: import('@varve/shared').ManagedColorShim,
  config: ProofTransformConfig,
): import('@varve/shared').ManagedColorShim {
  const normalized = managedColorToNormalized(color);
  const normalizedResult = applyProofToNormalized(normalized, config);
  if (normalizedResult.kind !== 'unavailable') {
    const [r, g, b, a] = normalizedResult.rgba;
    return { ...color, space: 'rgb', bitDepth: 'float32', r, g, b, a };
  }

  const rgba = managedColorToRgba(color);
  const result = applyProofToRgba(rgba, config);
  if (result.kind === 'unavailable') return color;
  const [r, g, b, a] = result.rgba;
  return { ...color, space: 'rgb', r, g, b, a };
}

/**
 * Apply the proof transform to a full render item. Returns the SAME object
 * when proofing is unavailable or nothing changed, so callers can skip
 * re-render work on the hot path.
 */
export function applyProofToItem(item: RenderItem, config: ProofTransformConfig): RenderItem {
  const fill = proofColor(item.fill, config);
  let next: RenderItem = fill === item.fill ? item : { ...item, fill };

  const proofedFills = next.fills?.map((f) => {
    if (f.type === 'solid') {
      const c = proofColor(f.color, config);
      return c === f.color ? f : { ...f, color: c };
    }
    if (f.type === 'gradient') {
      const stops = f.stops.map((s) => {
        const c = proofColor(s.color, config);
        return c === s.color ? s : { ...s, color: c };
      });
      return stops === f.stops ? f : { ...f, stops };
    }
    return f;
  });
  if (proofedFills !== next.fills) {
    next = { ...next, fills: proofedFills };
  }

  const proofedStrokes = next.strokes?.map((s) => {
    const c = proofColor(s.color, config);
    return c === s.color ? s : { ...s, color: c };
  });
  if (proofedStrokes !== next.strokes) {
    next = { ...next, strokes: proofedStrokes };
  }

  const proofedEffects = next.effects?.map((e) => {
    if ('color' in e && e.color) {
      const c = proofColor(e.color, config);
      return c === e.color ? e : { ...e, color: c };
    }
    if (e.type === 'glassMaterial') {
      const tint = proofColor(e.tint, config);
      const edge = proofColor(e.edgeHighlightColor, config);
      if (tint === e.tint && edge === e.edgeHighlightColor) return e;
      return { ...e, tint, edgeHighlightColor: edge };
    }
    return e;
  });
  if (proofedEffects !== next.effects) {
    next = { ...next, effects: proofedEffects };
  }

  const primitive = next.primitive;
  if (primitive && primitive.kind === 'text' && primitive.richText) {
    let runsChanged = false;
    const paragraphs = primitive.richText.paragraphs.map((para) => {
      const runs = para.runs.map((run) => {
        if (!run.format?.color) return run;
        const c = proofColor(run.format.color, config);
        if (c === run.format.color) return run;
        runsChanged = true;
        return { ...run, format: { ...run.format, color: c } };
      });
      return runs === para.runs ? para : { ...para, runs };
    });
    if (runsChanged) {
      next = {
        ...next,
        primitive: {
          ...primitive,
          richText: { ...primitive.richText, paragraphs },
        },
      };
    }
  }

  return next;
}

/**
 * Apply the proof transform to a full IR frame. Returns the same array
 * identity when proofing is unavailable so callers can skip re-render work.
 */
export function applyProofToIr(items: RenderItem[], config: ProofTransformConfig): RenderItem[] {
  let changed = false;
  const out = items.map((item) => {
    const next = applyProofToItem(item, config);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : items;
}

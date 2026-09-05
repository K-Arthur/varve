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

type DisplayProofColor = import('@varve/shared').ManagedColorShim & {
  profile?: string;
  profileFingerprint?: string;
};

/**
 * A proof converter returns display-sRGB values. Its result must not retain
 * the source profile metadata: doing so would make replay resolve, for
 * example, already-proofed sRGB numbers as Display P3 and transform them a
 * second time. This copy is display-only and never reaches the document.
 */
function displaySrgbProofColor(
  source: import('@varve/shared').ManagedColorShim,
  rgba: readonly [number, number, number, number],
  bitDepth?: 'uint8' | 'float32',
): import('@varve/shared').ManagedColorShim {
  const result: DisplayProofColor = {
    ...source,
    space: 'rgb',
    ...(bitDepth ? { bitDepth } : {}),
    r: rgba[0],
    g: rgba[1],
    b: rgba[2],
    a: rgba[3],
  } as DisplayProofColor;
  delete result.profile;
  delete result.profileFingerprint;
  return result;
}

/** Map an array only when one of its values changes identity. */
function mapIfChanged<T>(
  values: readonly T[] | undefined,
  mapper: (value: T) => T,
): T[] | undefined {
  if (!values) return undefined;
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapper(value);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : (values as T[]);
}

function proofColor(
  color: import('@varve/shared').ManagedColorShim,
  config: ProofTransformConfig,
): import('@varve/shared').ManagedColorShim {
  const normalized = managedColorToNormalized(color);
  const normalizedResult = applyProofToNormalized(normalized, config);
  if (normalizedResult.kind !== 'unavailable') {
    return displaySrgbProofColor(color, normalizedResult.rgba, 'float32');
  }

  const rgba = managedColorToRgba(color);
  const result = applyProofToRgba(rgba, config);
  if (result.kind === 'unavailable') return color;
  return displaySrgbProofColor(color, result.rgba);
}

/**
 * Apply the proof transform to a full render item. Returns the SAME object
 * when proofing is unavailable or nothing changed, so callers can skip
 * re-render work on the hot path.
 */
export function applyProofToItem(item: RenderItem, config: ProofTransformConfig): RenderItem {
  const fill = proofColor(item.fill, config);
  let next: RenderItem = fill === item.fill ? item : { ...item, fill };

  const proofedFills = mapIfChanged(next.fills, (f) => {
    if (f.type === 'solid') {
      const c = proofColor(f.color, config);
      return c === f.color ? f : { ...f, color: c };
    }
    if (f.type === 'gradient') {
      const stops = mapIfChanged(f.stops, (s) => {
        const c = proofColor(s.color, config);
        return c === s.color ? s : { ...s, color: c };
      });
      return stops === f.stops ? f : { ...f, stops: stops ?? [] };
    }
    return f;
  });
  if (proofedFills !== next.fills) {
    next = { ...next, fills: proofedFills };
  }

  const proofedStrokes = mapIfChanged(next.strokes, (s) => {
    const c = proofColor(s.color, config);
    return c === s.color ? s : { ...s, color: c };
  });
  if (proofedStrokes !== next.strokes) {
    next = { ...next, strokes: proofedStrokes };
  }

  const proofedEffects = mapIfChanged(next.effects, (e) => {
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

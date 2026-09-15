/**
 * Source-frame compositor — the single home of disposal/blend/rect
 * composition semantics for animated media.
 *
 * Every consumer (canvas, thumbnails, export, video, every decoder provider)
 * routes displayed frames through this module. Providers deliver *source*
 * frames (rect-sized RGBA + disposal/blend hints, or `preComposited` full
 * canvases); this module produces full-canvas RGBA states.
 *
 * Composition model per frame i (source semantics):
 *   1. canvas starts as the displayed state after frame i-1's disposal
 *   2. frame i is drawn into its rect (blend `source` replaces, `over`
 *      alpha-blends)
 *   3. frame i's disposal applies for the *next* frame (none: keep;
 *      background: clear rect to transparent; previous: restore the canvas
 *      as it was before frame i was drawn — saved before drawing)
 *
 * Math is deterministic integer arithmetic (no floats) so goldens are exact
 * across platforms. Over-blend: standard straight-alpha source-over:
 *   a_out = a_s + a_d * (1 - a_s)
 *   c_out = (c_s * a_s + c_d * a_d * (1 - a_s)) / a_out
 * with 0..255 scales and rounding at each step.
 */

import type { CompositedFrame, DecodedSourceFrame } from './types';

/** Full-canvas composited state (the unit cached by frame cache/checkpoints). */
export interface CompositeState {
  frameIndex: number;
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Create a blank (transparent) canvas state. */
export function createCompositeState(width: number, height: number): CompositeState {
  return { frameIndex: -1, width, height, rgba: new Uint8Array(width * height * 4) };
}

function blendOver(dst: Uint8Array, src: Uint8Array, o: number, s: number): void {
  const sa = src[s + 3]!;
  if (sa === 0) return;
  const da = dst[o + 3]!;
  if (sa === 255 || da === 0) {
    dst[o]! = src[s]!;
    dst[o + 1]! = src[s + 1]!;
    dst[o + 2]! = src[s + 2]!;
    dst[o + 3]! = sa;
    return;
  }
  const inv = 255 - sa;
  const oa = Math.round(sa + (da * inv) / 255);
  for (let c = 0; c < 3; c++) {
    const sv = src[s + c]!;
    const dv = dst[o + c]!;
    dst[o + c]! = oa === 0 ? 0 : Math.round((sv * sa + (dv * da * inv) / 255) / oa);
  }
  dst[o + 3]! = oa;
}

/** Paste a source frame into a canvas state per its rect and blend rule. */
export function drawSourceFrame(state: CompositeState, source: DecodedSourceFrame): CompositeState {
  const { width, height } = state;
  const rectW = source.width;
  const rectH = source.height;
  const src = source.rgba;
  const dst = state.rgba;
  if (src.length < rectW * rectH * 4) {
    throw new Error(`source frame ${source.index} truncated`);
  }
  if (source.preComposited) {
    // full-canvas frame; the decoder already applied prior-frame state
    dst.set(src.subarray(0, width * height * 4));
    return state;
  }
  if (source.blend === 'over') {
    for (let y = 0; y < rectH; y++) {
      const dy = source.y + y;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < rectW; x++) {
        const dx = source.x + x;
        if (dx < 0 || dx >= width) continue;
        const o = (dy * width + dx) * 4;
        const s = (y * rectW + x) * 4;
        blendOver(dst, src, o, s);
      }
    }
  } else {
    for (let y = 0; y < rectH; y++) {
      const dy = source.y + y;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < rectW; x++) {
        const dx = source.x + x;
        if (dx < 0 || dx >= width) continue;
        const o = (dy * width + dx) * 4;
        const s = (y * rectW + x) * 4;
        dst[o]! = src[s]!;
        dst[o + 1]! = src[s + 1]!;
        dst[o + 2]! = src[s + 2]!;
        dst[o + 3]! = src[s + 3]!;
      }
    }
  }
  return state;
}

function clearRect(state: CompositeState, x: number, y: number, w: number, h: number): void {
  const { width, height } = state;
  for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) {
    const start = Math.max(0, x);
    const end = Math.min(width, x + w);
    state.rgba.fill(0, (row * width + start) * 4, (row * width + end) * 4);
  }
}

/**
 * Composite a run of source frames, returning the displayed state after each
 * plus the final working state (after the last frame's disposal — the
 * natural checkpoint payload: the state the *next* frame draws on).
 *
 * `startState` must be the post-disposal state of the frame preceding
 * `sources[0]` (a checkpoint); when absent, composition begins from a blank
 * canvas at source frame 0.
 *
 * Disposal semantics: frame i's disposal is applied when advancing past it
 * (none: keep; background: clear rect; previous: restore pre-frame state).
 */
export function compositeRange(
  startState: CompositeState | undefined,
  sources: DecodedSourceFrame[],
): { states: CompositeState[]; finalState: CompositeState } {
  if (sources.length === 0) {
    const empty = startState ?? createCompositeState(0, 0);
    return { states: [], finalState: empty };
  }
  const first = sources[0];
  const initial = startState ?? createCompositeState(first!.width, first!.height);
  const width = initial.width;
  const height = initial.height;
  const states: CompositeState[] = [];
  let state: CompositeState;
  if (startState) {
    state = { ...startState, rgba: new Uint8Array(startState.rgba) };
  } else {
    state = initial;
  }

  for (const source of sources) {
    // 'previous' disposal restores the canvas to its state *before* this
    // frame was drawn — save it now if needed.
    const saved = source.disposal === 'previous' ? new Uint8Array(state.rgba) : null;
    // preComposited frames include prior state already
    if (source.preComposited) {
      state.rgba.set(source.rgba.subarray(0, width * height * 4));
    } else {
      drawSourceFrame(state, source);
    }
    const displayed = {
      frameIndex: source.index,
      width,
      height,
      rgba: new Uint8Array(state.rgba),
    };
    states.push(displayed);
    // apply this frame's disposal for the next frame
    if (source.disposal === 'background') {
      clearRect(state, source.x, source.y, source.width, source.height);
    } else if (source.disposal === 'previous' && saved) {
      state.rgba.set(saved);
    }
  }
  return { states, finalState: state };
}

/**
 * Convenience: composite a full sequence from scratch into
 * `CompositedFrame`s (frame index + bytes), matching the cache payload.
 */
export function compositeAll(
  canvasWidth: number,
  canvasHeight: number,
  sources: DecodedSourceFrame[],
): CompositedFrame[] {
  const { states } = compositeRange(undefined, sources);
  return states.map((s) => ({
    frameIndex: s.frameIndex,
    width: canvasWidth,
    height: canvasHeight,
    rgba: s.rgba,
  }));
}

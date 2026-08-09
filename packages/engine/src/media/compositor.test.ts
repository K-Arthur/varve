/**
 * Golden composition tests: deterministic disposal/blend/delta semantics
 * with exact pixel assertions. These are the authoritative semantics spec
 * for every consumer (canvas, export, video, all providers).
 */

import { describe, expect, it } from 'vitest';
import { compositeAll, compositeRange, createCompositeState } from './compositor';
import {
  buildFrameTiming,
  frameIndexForTime,
  timeForFrame,
  visibleDurationMs,
} from './frameResolver';
import { resolveUsageFrame, usageTiming } from './playback';
import type { DecodedSourceFrame, MediaFillSettings } from './types';

function solid(w: number, h: number, color: [number, number, number, number]): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = color[3];
  }
  return px;
}

function frame(
  index: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number, number],
  opts: Partial<DecodedSourceFrame> = {},
): DecodedSourceFrame {
  return {
    index,
    x,
    y,
    width: w,
    height: h,
    durationMs: opts.durationMs ?? 40,
    blend: opts.blend ?? 'source',
    disposal: opts.disposal ?? 'none',
    preComposited: opts.preComposited ?? false,
    rgba: solid(w, h, color),
  };
}

function px(rgba: Uint8Array, w: number, x: number, y: number): [number, number, number, number] {
  const o = (y * w + x) * 4;
  return [rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!];
}

const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const GREEN: [number, number, number, number] = [0, 255, 0, 255];
const HALF_RED: [number, number, number, number] = [255, 0, 0, 128];
const HALF_WHITE: [number, number, number, number] = [255, 255, 255, 128];
const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];

describe('compositor: full-frame sequences', () => {
  it('plain full replacements (GIF/APNG typical)', () => {
    const frames = [
      frame(0, 0, 0, 4, 4, RED),
      frame(1, 0, 0, 4, 4, GREEN),
      frame(2, 0, 0, 4, 4, BLUE),
    ];
    const result = compositeAll(4, 4, frames);
    expect(result.map((f) => f.frameIndex)).toEqual([0, 1, 2]);
    expect(px(result[0]!.rgba, 4, 0, 0)).toEqual(RED);
    expect(px(result[1]!.rgba, 4, 3, 3)).toEqual(GREEN);
    expect(px(result[2]!.rgba, 4, 0, 3)).toEqual(BLUE);
  });
});

describe('compositor: disposal', () => {
  it('background disposal clears the rect after the frame', () => {
    // f0 red full (dispose background), f1 blue 2x2 delta at +1+1:
    // displayed f1 = blue rect over transparent elsewhere
    const frames = [
      frame(0, 0, 0, 4, 4, RED, { disposal: 'background' }),
      frame(1, 1, 1, 2, 2, BLUE),
    ];
    const [f0, f1] = compositeAll(4, 4, frames);
    expect(px(f0!.rgba, 4, 0, 0)).toEqual(RED);
    // f1: blue delta, everything else transparent (f0 was disposed)
    expect(px(f1!.rgba, 4, 1, 1)).toEqual(BLUE);
    expect(px(f1!.rgba, 4, 0, 0)).toEqual(TRANSPARENT);
    expect(px(f1!.rgba, 4, 3, 3)).toEqual(TRANSPARENT);
  });

  it('previous disposal restores the pre-frame state', () => {
    // f0 red full; f1 blue 2x2 at +1+1 with disposal previous; f2 green
    // 2x2 at +2+2. After f1 the canvas must return to red.
    const frames = [
      frame(0, 0, 0, 4, 4, RED),
      frame(1, 1, 1, 2, 2, BLUE, { disposal: 'previous' }),
      frame(2, 2, 2, 2, 2, GREEN),
    ];
    const result = compositeAll(4, 4, frames);
    expect(px(result[0]!.rgba, 4, 2, 2)).toEqual(RED);
    expect(px(result[1]!.rgba, 4, 1, 1)).toEqual(BLUE);
    expect(px(result[1]!.rgba, 4, 0, 0)).toEqual(RED);
    // f2 displayed: green delta over restored red
    expect(px(result[2]!.rgba, 4, 2, 2)).toEqual(GREEN);
    expect(px(result[2]!.rgba, 4, 1, 1)).toEqual(RED);
    expect(px(result[2]!.rgba, 4, 0, 0)).toEqual(RED);
  });

  it('delta rectangles accumulate when disposal keeps', () => {
    const frames = [
      frame(0, 0, 0, 4, 4, RED),
      frame(1, 1, 1, 2, 2, BLUE), // keep
      frame(2, 2, 2, 2, 2, GREEN), // keep
    ];
    const result = compositeAll(4, 4, frames);
    // f2 shows red canvas with blue at +1+1 and green at +2+2
    expect(px(result[2]!.rgba, 4, 1, 1)).toEqual(BLUE);
    expect(px(result[2]!.rgba, 4, 2, 2)).toEqual(GREEN);
    expect(px(result[2]!.rgba, 4, 0, 0)).toEqual(RED);
    expect(px(result[2]!.rgba, 4, 3, 3)).toEqual(GREEN); // inside f2's rect
  });
});

describe('compositor: blend', () => {
  it('source blend replaces pixels (alpha included)', () => {
    const frames = [
      frame(0, 0, 0, 4, 4, HALF_RED),
      frame(1, 1, 1, 2, 2, HALF_WHITE, { blend: 'source' }),
    ];
    const result = compositeAll(4, 4, frames);
    expect(px(result[1]!.rgba, 4, 1, 1)).toEqual(HALF_WHITE);
    expect(px(result[1]!.rgba, 4, 0, 0)).toEqual(HALF_RED);
  });

  it('over blend alpha-composites within the rect', () => {
    const frames = [
      frame(0, 0, 0, 4, 4, HALF_RED),
      frame(1, 1, 1, 2, 2, HALF_WHITE, { blend: 'over' }),
    ];
    const result = compositeAll(4, 4, frames);
    // straight-alpha source-over, byte math:
    //   a_out = 128 + 128*(127/255) = 192
    //   c_out = (c_s*128 + c_d*128*127/255) / 192
    //   R: (255*128 + 255*16256/255... ) -> (32640 + 16256)/192 = 255
    //   G/B: (255*128 + 0)/192 = 170
    expect(px(result[1]!.rgba, 4, 1, 1)).toEqual([255, 170, 170, 192]);
    // outside the rect untouched
    expect(px(result[1]!.rgba, 4, 0, 0)).toEqual(HALF_RED);
  });

  it('over blend with opaque source replaces', () => {
    const frames = [frame(0, 0, 0, 4, 4, HALF_RED), frame(1, 1, 1, 2, 2, BLUE, { blend: 'over' })];
    const result = compositeAll(4, 4, frames);
    expect(px(result[1]!.rgba, 4, 1, 1)).toEqual(BLUE);
  });
});

describe('compositor: pre-composited frames', () => {
  it('pre-composited full canvases paste verbatim (WebP path)', () => {
    const f0 = frame(0, 0, 0, 4, 4, RED);
    const f1: DecodedSourceFrame = {
      ...frame(1, 0, 0, 4, 4, BLUE),
      preComposited: true,
    };
    const result = compositeAll(4, 4, [f0, f1]);
    expect(px(result[1]!.rgba, 4, 0, 0)).toEqual(BLUE);
  });
});

describe('compositor: checkpoint resume', () => {
  it('resuming from a checkpoint state equals full composition', () => {
    const frames = [
      frame(0, 0, 0, 4, 4, RED),
      frame(1, 1, 1, 2, 2, BLUE, { disposal: 'background' }),
      frame(2, 2, 2, 2, 2, GREEN),
      frame(3, 0, 0, 1, 1, BLUE),
    ];
    const full = compositeAll(4, 4, frames);
    // checkpoint = the post-disposal state after frame 1 (the state frame 2
    // draws on) — compositeRange returns it as `finalState`
    const { finalState } = compositeRange(undefined, frames.slice(0, 2));
    const resumed = compositeRange(finalState, frames.slice(2));
    expect(resumed.states.map((s) => s.frameIndex)).toEqual([2, 3]);
    expect(resumed.states[0]!.rgba).toEqual(full[2]!.rgba);
    expect(resumed.states[1]!.rgba).toEqual(full[3]!.rgba);
    // and the resumed final state equals a fresh composition of everything
    const again = compositeRange(undefined, frames);
    expect(resumed.finalState.rgba).toEqual(again.finalState.rgba);
  });
});

describe('frame resolver: timing', () => {
  const timing = buildFrameTiming([40, 100, 20, 60]);

  it('cumulative table', () => {
    expect([...timing.cum]).toEqual([0, 40, 140, 160, 220]);
    expect(timing.totalMs).toBe(220);
  });

  it('exact boundary semantics', () => {
    expect(frameIndexForTime(timing, 0)).toBe(0);
    expect(frameIndexForTime(timing, 40)).toBe(1); // frame 1 starts at 40
    expect(frameIndexForTime(timing, 140)).toBe(2);
    expect(frameIndexForTime(timing, 160)).toBe(3);
  });

  it('mid-frame times and the end', () => {
    expect(frameIndexForTime(timing, 39)).toBe(0);
    expect(frameIndexForTime(timing, 41)).toBe(1);
    expect(frameIndexForTime(timing, 139)).toBe(1);
    expect(frameIndexForTime(timing, 219)).toBe(3);
    expect(frameIndexForTime(timing, 220)).toBe(3);
    expect(frameIndexForTime(timing, 10_000)).toBe(3);
    expect(frameIndexForTime(timing, -5)).toBe(0);
  });

  it('zero-duration frames collapse for time resolution', () => {
    const t = buildFrameTiming([40, 0, 100]);
    expect(frameIndexForTime(t, 0)).toBe(0);
    expect(frameIndexForTime(t, 39)).toBe(0);
    expect(frameIndexForTime(t, 40)).toBe(2); // frame 1 (0ms) never current
    expect(frameIndexForTime(t, 139)).toBe(2);
  });

  it('timeForFrame windows', () => {
    expect(timeForFrame(timing, 1)).toEqual({ startMs: 40, endMs: 140 });
    expect(timeForFrame(timing, 5)).toEqual({ startMs: 160, endMs: 220 }); // clamped
  });

  it('visibleDurationMs collapses trailing zero runs', () => {
    expect(visibleDurationMs(buildFrameTiming([40, 0, 100]))).toBe(140);
    expect(visibleDurationMs(buildFrameTiming([0, 0]))).toBe(0);
  });

  it('rejects invalid durations', () => {
    expect(() => buildFrameTiming([40, Number.NaN])).toThrow();
    expect(() => buildFrameTiming([-1])).toThrow();
  });
});

describe('playback: usage resolution', () => {
  const timing = usageTiming([{ durationMs: 40 }, { durationMs: 100 }, { durationMs: 20 }]);

  function settings(overrides: Partial<MediaFillSettings> = {}): MediaFillSettings {
    return {
      loopMode: 'source',
      rate: 1,
      startOffsetMs: 0,
      inPointMs: 0,
      outPointMs: 0,
      posterFrame: 0,
      ...overrides,
    };
  }

  it('source loop (infinite) maps times to frames', () => {
    const input = { settings: settings(), sourceLoopCount: 'infinite' as const, timing };
    expect(resolveUsageFrame(input, 0).frameIndex).toBe(0);
    expect(resolveUsageFrame(input, 40).frameIndex).toBe(1);
    expect(resolveUsageFrame(input, 140).frameIndex).toBe(2);
    expect(resolveUsageFrame(input, 160).frameIndex).toBe(0); // wrapped
    expect(resolveUsageFrame(input, 320).frameIndex).toBe(0); // two full loops
    expect(resolveUsageFrame(input, 160).iteration).toBe(1);
  });

  it('once mode holds the last frame', () => {
    const input = {
      settings: settings({ loopMode: 'once' }),
      sourceLoopCount: 'infinite' as const,
      timing,
    };
    expect(resolveUsageFrame(input, 0).frameIndex).toBe(0);
    expect(resolveUsageFrame(input, 50).frameIndex).toBe(1);
    expect(resolveUsageFrame(input, 500).frameIndex).toBe(2);
    expect(resolveUsageFrame(input, 500).atEnd).toBe(true);
  });

  it('finite source loop plays N iterations then holds', () => {
    const input = {
      settings: settings({ loopMode: 'source' }),
      sourceLoopCount: 2 as const,
      timing,
    };
    // 2 iterations = 320 ms of playback; frames: f0 0-40, f1 40-140, f2 140-160
    expect(resolveUsageFrame(input, 150).frameIndex).toBe(2);
    expect(resolveUsageFrame(input, 180).frameIndex).toBe(0); // iteration 2
    expect(resolveUsageFrame(input, 320).frameIndex).toBe(2); // held end
    expect(resolveUsageFrame(input, 320).atEnd).toBe(true);
    expect(resolveUsageFrame(input, 10_000).frameIndex).toBe(2);
  });

  it('trim window (in/out points)', () => {
    const input = {
      settings: settings({ loopMode: 'loop', inPointMs: 40, outPointMs: 140 }),
      sourceLoopCount: 'infinite' as const,
      timing,
    };
    // window is frame 1 (40..140) looping
    expect(resolveUsageFrame(input, 0).frameIndex).toBe(1);
    expect(resolveUsageFrame(input, 100).frameIndex).toBe(1);
    expect(resolveUsageFrame(input, 140).frameIndex).toBe(1);
    expect(resolveUsageFrame(input, 140 + 60).frameIndex).toBe(1);
    expect(resolveUsageFrame(input, 140 + 100).frameIndex).toBe(1);
  });

  it('start offset shifts playback', () => {
    const input = {
      settings: settings({ loopMode: 'loop', startOffsetMs: 100 }),
      sourceLoopCount: 'infinite' as const,
      timing,
    };
    expect(resolveUsageFrame(input, 100).frameIndex).toBe(0);
    expect(resolveUsageFrame(input, 140).frameIndex).toBe(1);
  });

  it('rate 2x advances twice as fast', () => {
    const input = {
      settings: settings({ loopMode: 'loop', rate: 2 }),
      sourceLoopCount: 'infinite' as const,
      timing,
    };
    expect(resolveUsageFrame(input, 0).frameIndex).toBe(0);
    expect(resolveUsageFrame(input, 20).frameIndex).toBe(1); // 40ms elapsed
    expect(resolveUsageFrame(input, 70).frameIndex).toBe(2); // 140ms elapsed
    expect(resolveUsageFrame(input, 80).frameIndex).toBe(0); // wrapped at 160
  });

  it('negative rate reverses', () => {
    const input = {
      settings: settings({ loopMode: 'loop', rate: -1, startOffsetMs: 160 }),
      sourceLoopCount: 'infinite' as const,
      timing,
    };
    expect(resolveUsageFrame(input, 160).frameIndex).toBe(0);
    expect(resolveUsageFrame(input, 120).frameIndex).toBe(1); // 40ms back
    expect(resolveUsageFrame(input, 20).frameIndex).toBe(2); // 140ms back
    expect(resolveUsageFrame(input, 0).frameIndex).toBe(0); // wrapped
    expect(resolveUsageFrame(input, 160).direction).toBe(-1);
  });

  it('pingpong alternates direction at window edges', () => {
    const input = {
      settings: settings({ loopMode: 'pingpong' }),
      sourceLoopCount: 'infinite' as const,
      timing,
    };
    // period 320ms: 0→160 forward, 160→320 backward
    expect(resolveUsageFrame(input, 0).frameIndex).toBe(0);
    expect(resolveUsageFrame(input, 150).frameIndex).toBe(2); // t=150 (f2 140-160)
    expect(resolveUsageFrame(input, 160).frameIndex).toBe(2); // at the turn
    expect(resolveUsageFrame(input, 190).frameIndex).toBe(1); // t=130, moving back
    expect(resolveUsageFrame(input, 250).frameIndex).toBe(1); // t=70
    expect(resolveUsageFrame(input, 290).frameIndex).toBe(0); // t=30
    expect(resolveUsageFrame(input, 310).frameIndex).toBe(0); // t=10, near the turn
    expect(resolveUsageFrame(input, 330).frameIndex).toBe(0); // forward again
    expect(resolveUsageFrame(input, 470).frameIndex).toBe(2); // t=150 forward
  });
});

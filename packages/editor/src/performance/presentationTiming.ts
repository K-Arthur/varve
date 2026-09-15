/**
 * Presentation timing — what each runtime can actually prove about when a
 * frame became visible.
 *
 * There are five distinct boundaries and no web API exposes all of them:
 *
 *   1. the app submitted a frame            → `render.commit`   (measured)
 *   2. the browser accepted it              → `frame.callback`  (measured)
 *   3. the browser composited it            → `composite.estimated` (bounded)
 *   4. the OS compositor presented it       → `present.feedback` (Event Timing)
 *   5. the display scanned it out           → not observable from JS
 *
 * Nothing here is named `composite.present`, because none of these signals is
 * an OS presentation timestamp. Event Timing's `duration` is the closest —
 * it measures input event to next paint — but it is quantized to 8ms and
 * covers the *event*, not an arbitrary frame, so it is reported as
 * `present.feedback` with its quantization recorded as uncertainty.
 */
import type { ClockSource } from './clockDomain';
import { recordInteractionSpanAt } from './interactionTrace';

export interface PresentationCapabilities {
  /** PerformanceObserver supports the `event` entry type (input → next paint). */
  eventTiming: boolean;
  /** PerformanceObserver supports `long-animation-frame` (Chromium). */
  longAnimationFrame: boolean;
  /** requestAnimationFrame is available for a bounded composite estimate. */
  rafEstimate: boolean;
}

/**
 * Event Timing rounds `duration` to the nearest 8ms to limit its use as a
 * high-resolution timer. That rounding is the dominant uncertainty in any
 * presentation figure derived from it, and must be reported rather than
 * hidden behind a precise-looking number.
 */
export const EVENT_TIMING_QUANTIZATION_MS = 8;

function supportedEntryTypes(): readonly string[] {
  if (typeof PerformanceObserver === 'undefined') return [];
  const types = (PerformanceObserver as { supportedEntryTypes?: readonly string[] })
    .supportedEntryTypes;
  return Array.isArray(types) ? types : [];
}

export function detectPresentationCapabilities(): PresentationCapabilities {
  const types = supportedEntryTypes();
  return {
    eventTiming: types.includes('event'),
    longAnimationFrame: types.includes('long-animation-frame'),
    rafEstimate: typeof requestAnimationFrame === 'function',
  };
}

/** A presentation observation, with the evidence class it came from. */
export interface PresentationSample {
  /** Span name — reflects the evidence class, never a presentation claim. */
  name: 'present.feedback' | 'composite.estimated' | 'frame.callback';
  startTimeMs: number;
  durationMs: number;
  /** Half-width of the uncertainty interval in milliseconds. */
  uncertaintyMs: number;
  source: ClockSource;
  attributes: Record<string, string | number | boolean>;
}

/**
 * Interpret an Event Timing entry as presentation evidence.
 *
 * `startTime` → `processingStart` is input delay; `processingStart` →
 * `processingEnd` is handler work already covered by `interaction.dispatch`;
 * `startTime + duration` is the next paint after the event, which is the only
 * genuine presentation signal available to a production web build.
 */
export function presentationFromEventTiming(entry: {
  name: string;
  startTime: number;
  duration: number;
  processingStart?: number;
  processingEnd?: number;
}): PresentationSample {
  const processingStart = entry.processingStart ?? entry.startTime;
  const processingEnd = entry.processingEnd ?? processingStart;
  return {
    name: 'present.feedback',
    startTimeMs: entry.startTime,
    durationMs: entry.duration,
    uncertaintyMs: EVENT_TIMING_QUANTIZATION_MS,
    source: 'main.performance.now',
    attributes: {
      evidence: 'event-timing',
      eventName: entry.name,
      inputDelayMs: Math.max(0, processingStart - entry.startTime),
      processingMs: Math.max(0, processingEnd - processingStart),
      // Everything after the handler: style, layout, paint and compositing up
      // to the paint the browser attributes to this event.
      presentationMs: Math.max(0, entry.startTime + entry.duration - processingEnd),
      quantizationMs: EVENT_TIMING_QUANTIZATION_MS,
    },
  };
}

/**
 * Bound the composite from a `requestAnimationFrame` callback that ran after a
 * commit.
 *
 * The callback fires at the start of the next frame's rendering, so it is a
 * *lower* bound on when compositing happened, not the composite itself. The
 * uncertainty is the remaining frame interval, which is why this is called
 * `composite.estimated`.
 */
export function estimateCompositeFromRaf(
  committedAtMs: number,
  rafTimestampMs: number,
  refreshIntervalMs: number,
): PresentationSample {
  const durationMs = Math.max(0, rafTimestampMs - committedAtMs);
  return {
    name: 'composite.estimated',
    startTimeMs: committedAtMs,
    durationMs,
    // The true composite lies somewhere in the frame that starts at the rAF
    // callback, so the estimate can be understated by up to one interval.
    uncertaintyMs: refreshIntervalMs,
    source: 'main.performance.now',
    attributes: {
      evidence: 'raf-lower-bound',
      bound: 'lower',
      refreshIntervalMs,
    },
  };
}

/**
 * Rolling estimate of the display's frame interval, from observed
 * `requestAnimationFrame` deltas. The minimum of a small window is used
 * because a delta can only be *longer* than the refresh interval (a dropped
 * or delayed frame), never shorter.
 */
export class RefreshIntervalEstimator {
  private readonly window: number[] = [];
  private lastTimestampMs: number | null = null;
  private static readonly WINDOW = 12;
  /** Fallback until enough samples exist: the 60Hz interval. */
  static readonly DEFAULT_INTERVAL_MS = 1000 / 60;

  sample(rafTimestampMs: number): void {
    if (this.lastTimestampMs !== null) {
      const delta = rafTimestampMs - this.lastTimestampMs;
      // Reject implausible deltas: a backgrounded tab, a paused animation
      // frame, or a duplicate timestamp are not refresh-rate evidence.
      if (delta >= 1 && delta <= 100) {
        this.window.push(delta);
        if (this.window.length > RefreshIntervalEstimator.WINDOW) this.window.shift();
      }
    }
    this.lastTimestampMs = rafTimestampMs;
  }

  get intervalMs(): number {
    if (this.window.length === 0) return RefreshIntervalEstimator.DEFAULT_INTERVAL_MS;
    return Math.min(...this.window);
  }

  /** Drop history — call when the surface or display may have changed. */
  reset(): void {
    this.window.length = 0;
    this.lastTimestampMs = null;
  }
}

type Disposer = () => void;

/**
 * Observe presentation for the active interaction trace.
 *
 * Returns a disposer; a no-op one when the runtime exposes no usable signal,
 * so callers do not need capability checks of their own. Only interactions
 * above `durationThresholdMs` are reported, which keeps a fast drag from
 * emitting an entry per pointer event.
 */
export function observePresentation(durationThresholdMs = 16): Disposer {
  const capabilities = detectPresentationCapabilities();
  if (!capabilities.eventTiming) return () => undefined;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const sample = presentationFromEventTiming(
          entry as unknown as Parameters<typeof presentationFromEventTiming>[0],
        );
        recordInteractionSpanAt(sample.name, sample.startTimeMs, sample.durationMs, {
          ...sample.attributes,
          uncertaintyMs: sample.uncertaintyMs,
        });
      }
    });
    observer.observe({
      type: 'event',
      buffered: false,
      durationThreshold: durationThresholdMs,
    } as PerformanceObserverInit);
  } catch {
    // An engine that advertises the entry type but rejects the options bag
    // must degrade to no presentation evidence, never throw into the caller.
    return () => undefined;
  }
  return () => observer?.disconnect();
}

/**
 * Per-platform presentation-evidence matrix. Kept next to the implementation
 * so the honest answer to "can we see presentation here?" travels with the
 * code that tries to.
 */
export const PRESENTATION_EVIDENCE_BY_RUNTIME = {
  chromium: {
    boundary: 'input → next paint',
    span: 'present.feedback',
    accuracy: '±8ms (Event Timing quantization)',
    productionSafe: true,
    requiresProfiler: false,
    perInteraction: true,
  },
  webview2: {
    boundary: 'input → next paint',
    span: 'present.feedback',
    accuracy: '±8ms (Event Timing quantization)',
    productionSafe: true,
    requiresProfiler: false,
    perInteraction: true,
  },
  webkitgtk: {
    // WebKitGTK does not expose the `event` entry type; the rAF lower bound is
    // all a production build can prove without an external profiler.
    boundary: 'commit → next animation frame',
    span: 'composite.estimated',
    accuracy: 'lower bound, ±1 refresh interval',
    productionSafe: true,
    requiresProfiler: false,
    perInteraction: true,
  },
  wkwebview: {
    boundary: 'commit → next animation frame',
    span: 'composite.estimated',
    accuracy: 'lower bound, ±1 refresh interval',
    productionSafe: true,
    requiresProfiler: false,
    perInteraction: true,
  },
} as const;

/**
 * `interaction.dispatch` — the boundary between normalized user input and the
 * application interaction system.
 *
 * Deliberately narrower than `pointer.input`, which covers the whole handler
 * including hover hit-testing, cursor throttling and auto-pan bookkeeping.
 * This span isolates the tool finite-state-machine transition plus the
 * preview/scene mutation it dispatches, which is what makes "the handler was
 * slow" distinguishable from "the active tool did a lot of work". Merging the
 * two would make the timeline look complete while hiding exactly that split.
 */
import { eventQueueDelayMs } from './clockDomain';
import {
  isInteractionTracingEnabled,
  nextPointerSequenceId,
  recordInteractionSpan,
} from './interactionTrace';

export type DispatchPhase = 'down' | 'move' | 'up' | 'cancel';

/** Attributes describing the interaction, never document content. */
export interface DispatchAttributes {
  tool: string;
  docComplexity: string;
  selectionCount: number;
}

/** Coarse document-size bucket for trace attributes; never the raw node count. */
export function documentComplexityBucket(nodeCount: number): string {
  if (nodeCount < 100) return 'xs';
  if (nodeCount < 1_000) return 's';
  if (nodeCount < 10_000) return 'm';
  if (nodeCount < 50_000) return 'l';
  return 'xl';
}

/**
 * Minimal shape of the pointer event this span reads. Declared structurally so
 * the seam is testable without synthesizing a full DOM PointerEvent.
 */
export interface DispatchEventLike {
  timeStamp: number;
  pointerType: string;
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  getCoalescedEvents?: () => readonly unknown[];
}

/**
 * Run a tool dispatch inside an `interaction.dispatch` span.
 *
 * The span is closed in a `finally` so a throwing tool cannot leak an open
 * span, and the whole instrumentation path is skipped when tracing is off —
 * including `getCoalescedEvents()`, which allocates.
 */
export function dispatchToTool(
  phase: DispatchPhase,
  event: DispatchEventLike,
  attributes: DispatchAttributes,
  run: () => void,
): void {
  if (!isInteractionTracingEnabled()) {
    run();
    return;
  }
  const startedAt = performance.now();
  const coalescedCount = event.getCoalescedEvents?.().length ?? 0;
  const queueDelayMs = eventQueueDelayMs(event.timeStamp, startedAt);
  try {
    run();
  } finally {
    recordInteractionSpan('interaction.dispatch', performance.now() - startedAt, {
      ...attributes,
      phase,
      pointerType: event.pointerType,
      buttons: event.buttons,
      pointerSequenceId: nextPointerSequenceId(),
      coalescedCount,
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      meta: event.metaKey,
      // An untrusted clock is reported as such rather than as a zero delay, so
      // a platform whose event timestamps cannot be correlated is visible in
      // the trace instead of silently looking instantaneous.
      ...(queueDelayMs === null
        ? { queueDelayClock: 'untrusted' }
        : { queueDelayMs, queueDelayClock: 'dom.event.timeStamp' }),
    });
  }
}

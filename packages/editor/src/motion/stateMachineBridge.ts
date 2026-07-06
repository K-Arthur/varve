/**
 * Bridge state machines to timeline playback.
 */
import {
  advanceSMTransition,
  createStateMachineRuntime,
  getCurrentStateTimelineId,
  type Document,
  type SMRuntime,
} from '@strata/scene';

/** Get timeline id for the entry state of the first state machine on the document. */
export function getPrimaryStateMachineTimelineId(doc: Document): string | null {
  const smIds = Object.keys(doc.stateMachines ?? {});
  const firstId = smIds[0];
  if (!firstId) return null;
  try {
    const runtime = createStateMachineRuntime(doc, firstId);
    return getCurrentStateTimelineId(runtime) ?? null;
  } catch {
    return null;
  }
}

export function getTimelineIdForStateMachine(doc: Document, smId: string): string | null {
  try {
    const runtime = createStateMachineRuntime(doc, smId);
    return getCurrentStateTimelineId(runtime) ?? null;
  } catch {
    return null;
  }
}

export function advanceStateMachine(runtime: SMRuntime, deltaMs: number): SMRuntime {
  return advanceSMTransition(runtime, deltaMs);
}

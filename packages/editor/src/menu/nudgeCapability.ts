import type { Document, NodeId } from '@varve/scene';
import { getNudgeStep, planNudge } from '../commands/nudge';

/** One precomputed capability shared by every menu representation of nudge. */
export interface NudgeCapability {
  canNudge: boolean;
  reason: string | null;
}

/**
 * Derive menu enablement from the authoritative movement planner instead of
 * duplicating selection, hierarchy, lock, and layout eligibility checks.
 */
export function getNudgeCapability(
  document: Document,
  selection: readonly NodeId[],
): NudgeCapability {
  if (selection.length === 0) {
    return { canNudge: false, reason: 'Select a layer first' };
  }

  const plan = planNudge('right', getNudgeStep('standard'), document, selection);
  if (plan.moved > 0) return { canNudge: true, reason: null };
  if (plan.locked > 0) {
    return { canNudge: false, reason: 'Selected layers are locked or hidden' };
  }
  return { canNudge: false, reason: 'Selected layers are not manually positionable' };
}

import type { Document, NodeId } from '@varve/scene';
import { planManualWorldTranslation } from '../scene/selectionArrangement';

export type NudgeDirection = 'up' | 'down' | 'left' | 'right';
export type NudgeMode = 'standard' | 'large' | 'fine';

export interface NudgeContext {
  document: Document;
  selection: NodeId[];
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  /**
   * Batch setter: when present, all roots are applied in one document update
   * instead of spreading the nodes map once per selected item.
   */
  setNodePositions?: (positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>) => void;
}

export interface NudgeResult {
  moved: number;
  locked: number;
  skipped: number;
  total: number;
}

/** A pure, hierarchy-safe nudge ready for one mutation. */
export interface NudgePlan extends NudgeResult {
  positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>;
}

const NUDGE_STEPS: Record<NudgeMode, number> = {
  standard: 1,
  large: 10,
  fine: 0.5,
};

export function getNudgeStep(mode: NudgeMode): number {
  return NUDGE_STEPS[mode];
}

export function canNudge(selection: NodeId[]): boolean {
  return selection.length > 0;
}

export function getNudgeDisabledReason(selection: NodeId[]): string | null {
  if (selection.length === 0) return 'No selection';
  return null;
}

/**
 * Plan a document-space nudge without mutating the document. Every eligible
 * transform root receives the same placed-world delta; the shared arrangement
 * resolver converts it through any transformed parent back into local space.
 */
export function planNudge(
  direction: NudgeDirection,
  step: number,
  document: Document,
  selection: readonly NodeId[],
): NudgePlan {
  const { x, y } = nudgeDelta(direction, step);
  const plan = planManualWorldTranslation(document, selection, { x, y });
  return {
    positions: plan.positions,
    moved: plan.positions.length,
    locked: plan.locked,
    skipped: plan.skipped,
    total: selection.length,
  };
}

/** Apply a previously-planned nudge through the caller's mutation facade. */
export function applyNudgePlan(
  plan: NudgePlan,
  ctx: Pick<NudgeContext, 'setNodePosition' | 'setNodePositions'>,
): NudgeResult {
  if (plan.positions.length > 0 && ctx.setNodePositions) {
    ctx.setNodePositions(plan.positions);
  } else {
    for (const position of plan.positions) {
      ctx.setNodePosition(position.id, position.x, position.y);
    }
  }
  return {
    moved: plan.moved,
    locked: plan.locked,
    skipped: plan.skipped,
    total: plan.total,
  };
}

export function executeNudge(
  direction: NudgeDirection,
  step: number,
  ctx: NudgeContext,
): NudgeResult {
  return applyNudgePlan(planNudge(direction, step, ctx.document, ctx.selection), ctx);
}

function nudgeDelta(direction: NudgeDirection, step: number): { x: number; y: number } {
  switch (direction) {
    case 'left':
      return { x: -step, y: 0 };
    case 'right':
      return { x: step, y: 0 };
    case 'up':
      return { x: 0, y: -step };
    case 'down':
      return { x: 0, y: step };
  }
}

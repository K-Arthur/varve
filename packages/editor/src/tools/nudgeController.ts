import {
  applyNudgePlan,
  createNudgeGestureSession,
  getNudgeStep,
  type NudgeDirection,
  type NudgeGestureSession,
  planNudge,
  planNudgeRepeat,
} from '../commands/nudge';
import { loadSettings } from '../settings';
import type { ToolContext } from './types';

type NudgeContext = Pick<
  ToolContext,
  | 'document'
  | 'selection'
  | 'setNodePosition'
  | 'setNodePositions'
  | 'beginTransaction'
  | 'commitTransaction'
  | 'announceOperation'
>;

export function nudgeDirectionForKey(key: string): NudgeDirection | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

/**
 * Shared keyboard movement state machine used by Select and idle tools.
 * Keeping the repeat session here makes keyup/blur cleanup independent from
 * whichever tool happens to be active after the keydown.
 */
export class CanvasNudgeController {
  private heldDirections = new Set<NudgeDirection>();
  private session: NudgeGestureSession | null = null;

  get active(): boolean {
    return this.heldDirections.size > 0;
  }

  handleKeyDown(e: KeyboardEvent, ctx: NudgeContext): boolean {
    const direction = nudgeDirectionForKey(e.key);
    if (!direction) return false;

    if (e.altKey || e.ctrlKey || e.metaKey) {
      this.finish(ctx);
      return false;
    }

    const mode = e.shiftKey ? 'large' : 'standard';
    const step = getNudgeStep(mode, {
      small: loadSettings().nudge.small,
      big: loadSettings().nudge.big,
    });
    let plan = this.session
      ? planNudgeRepeat(this.session, direction, step, ctx.document, ctx.selection)
      : null;
    if (!plan) {
      this.session = null;
      plan = planNudge(direction, step, ctx.document, ctx.selection);
    }

    if (plan.moved === 0) {
      if (ctx.selection.length === 0) return false;
      this.finish(ctx);
      ctx.announceOperation(
        'Nudge',
        plan.locked > 0 ? 'Selected layers cannot move' : 'No movable layers',
      );
      return true;
    }

    const startsGesture = this.heldDirections.size === 0;
    this.heldDirections.add(direction);
    if (startsGesture) {
      ctx.beginTransaction();
      ctx.announceOperation('Nudge', `${formatAmount(step)}px`);
    }

    applyNudgePlan(plan, {
      setNodePosition: ctx.setNodePosition,
      setNodePositions: ctx.setNodePositions,
    });
    this.session ??= createNudgeGestureSession(ctx.document, ctx.selection, plan);
    return true;
  }

  handleKeyUp(e: KeyboardEvent, ctx: NudgeContext): boolean {
    const direction = nudgeDirectionForKey(e.key);
    if (!direction || !this.heldDirections.delete(direction)) return false;
    if (this.heldDirections.size === 0) {
      this.session = null;
      ctx.commitTransaction();
    }
    return true;
  }

  finish(ctx: NudgeContext): void {
    this.session = null;
    if (this.heldDirections.size === 0) return;
    this.heldDirections.clear();
    ctx.commitTransaction();
  }
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

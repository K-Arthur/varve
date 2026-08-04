import type { NodeId, SceneNode } from '@varve/scene';

export type NudgeDirection = 'up' | 'down' | 'left' | 'right';
export type NudgeMode = 'standard' | 'large' | 'fine';

export interface NudgeContext {
  document: { nodes: Record<string, SceneNode> };
  selection: NodeId[];
  getNode: (id: NodeId) => SceneNode | undefined;
  setNodePosition: (id: NodeId, x: number, y: number) => void;
}

export interface NudgeResult {
  moved: number;
  locked: number;
  skipped: number;
  total: number;
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

function isNodeMovable(node: SceneNode): boolean {
  if (node.locked === true) return false;
  if (node.visible === false) return false;
  if (node.kind === 'adjustment') return false;
  return true;
}

export function executeNudge(
  direction: NudgeDirection,
  step: number,
  ctx: NudgeContext,
): NudgeResult {
  const result: NudgeResult = { moved: 0, locked: 0, skipped: 0, total: ctx.selection.length };

  const dxRaw = direction === 'left' ? -step : direction === 'right' ? step : 0;
  const dyRaw = direction === 'up' ? -step : direction === 'down' ? step : 0;

  for (const id of ctx.selection) {
    const node = ctx.getNode(id);
    if (!node) {
      result.skipped++;
      continue;
    }
    if (!isNodeMovable(node)) {
      if (node.locked === true || node.visible === false) result.locked++;
      else result.skipped++;
      continue;
    }

    const t = node.transform ?? [1, 0, 0, 1, 0, 0];
    const [a, b, c, d] = t;

    const dx = dxRaw * a + dyRaw * c;
    const dy = dxRaw * b + dyRaw * d;

    ctx.setNodePosition(id, t[4] + dx, t[5] + dy);
    result.moved++;
  }

  return result;
}

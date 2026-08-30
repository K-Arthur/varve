import type { Adjustment } from '@varve/engine';
import { adjustmentDefaults, makeAdjustment } from '@varve/engine';

/** Pure stack operations shared by Object Filters, Adjustment Layers, and Looks. */
export function moveEffect(
  stack: readonly Adjustment[],
  effectId: string,
  nextIndex: number,
): Adjustment[] {
  const next = [...stack];
  const index = next.findIndex((effect) => effect.id === effectId);
  if (index < 0) return next;
  const [effect] = next.splice(index, 1);
  if (!effect) return next;
  next.splice(Math.max(0, Math.min(nextIndex, next.length)), 0, effect);
  return next;
}

export function removeEffect(stack: readonly Adjustment[], effectId: string): Adjustment[] {
  return stack.filter((effect) => effect.id !== effectId);
}

export function duplicateEffect(
  stack: readonly Adjustment[],
  effectId: string,
  makeId: () => string,
): Adjustment[] {
  const index = stack.findIndex((effect) => effect.id === effectId);
  if (index < 0) return [...stack];
  const effect = stack[index]!;
  let copy: Adjustment;
  try {
    copy = JSON.parse(JSON.stringify(effect)) as Adjustment;
  } catch {
    copy = { ...effect } as Adjustment;
  }
  copy.id = makeId();
  const next = [...stack];
  next.splice(index + 1, 0, copy);
  return next;
}

export function resetEffect(effect: Adjustment, makeId = () => effect.id): Adjustment {
  return makeAdjustment(makeId(), effect.kind, adjustmentDefaults(effect.kind));
}

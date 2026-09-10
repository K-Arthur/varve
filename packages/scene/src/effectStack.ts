import type { Adjustment } from '@varve/engine';
import { adjustmentDefaults, makeAdjustment } from '@varve/engine';
import type { Effect } from './types';

/** Execution stage used by the Layer Effects renderer. */
export type LayerEffectStage = 'backdrop' | 'content' | 'appearance';

/**
 * Layer Effects are authored as one array, but execution has three stable
 * stages. Reordering is meaningful only within a stage; keeping that rule in
 * the scene package prevents the inspector from offering no-op moves.
 */
export function layerEffectStage(effect: Pick<Effect, 'type'>): LayerEffectStage {
  switch (effect.type) {
    case 'backgroundBlur':
    case 'glassMaterial':
      return 'backdrop';
    case 'layerBlur':
    case 'depthBlur':
    case 'gaussianBlur':
    case 'fieldBlur':
    case 'irisBlur':
    case 'tiltShiftBlur':
    case 'pathBlur':
    case 'spinBlur':
    case 'chromaticAberration':
    case 'glitch':
      return 'content';
    default:
      return 'appearance';
  }
}

/** Find the nearest same-stage row in the requested direction. */
export function layerEffectMoveTarget(
  stack: readonly Effect[],
  fromIndex: number,
  direction: -1 | 1,
): number {
  const source = stack[fromIndex];
  if (!source) return -1;
  const stage = layerEffectStage(source);
  for (let index = fromIndex + direction; index >= 0 && index < stack.length; index += direction) {
    if (layerEffectStage(stack[index]!) === stage) return index;
  }
  return -1;
}

/** Move an effect to the nearest meaningful position in its execution stage. */
export function moveLayerEffect(
  stack: readonly Effect[],
  effectId: string,
  direction: -1 | 1,
): Effect[] {
  const next = [...stack];
  const fromIndex = next.findIndex((effect) => effect.id === effectId);
  const targetIndex = layerEffectMoveTarget(next, fromIndex, direction);
  if (fromIndex < 0 || targetIndex < 0) return next;
  const [effect] = next.splice(fromIndex, 1);
  if (!effect) return next;
  next.splice(targetIndex, 0, effect);
  return next;
}

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

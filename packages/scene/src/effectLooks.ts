import type { Adjustment } from '@varve/engine';
import { adjustmentDefaults, isKnownAdjustmentKind, makeAdjustment } from '@varve/engine';
import { normalizeAdjustmentStack } from './adjustmentNormalization';

/** Versioned, declarative recipe stored with a Varve document. */
export interface EffectLook {
  id: string;
  schemaVersion: 1;
  name: string;
  description?: string;
  effects: Adjustment[];
  favorite?: boolean;
  createdAt?: number;
}

export interface EffectLookValidation {
  look: EffectLook | null;
  unknownEffects: number;
  droppedEffects: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : fallback;
}

/** Validate and normalize one untrusted imported or persisted Look. */
export function normalizeEffectLook(
  value: unknown,
  ownerId: string,
  index = 0,
): EffectLookValidation {
  if (!isRecord(value)) return { look: null, unknownEffects: 0, droppedEffects: 1 };
  const rawEffects = Array.isArray(value.effects) ? value.effects : [];
  const normalized = normalizeAdjustmentStack(rawEffects, `${ownerId}-${index}`);
  return {
    look: {
      id: boundedText(value.id, `look-${ownerId}-${index + 1}`, 160),
      schemaVersion: 1,
      name: boundedText(value.name, `Look ${index + 1}`, 120),
      ...(typeof value.description === 'string'
        ? { description: value.description.trim().slice(0, 500) }
        : {}),
      effects: normalized.adjustments,
      ...(value.favorite === true ? { favorite: true } : {}),
      ...(typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? { createdAt: Math.max(0, value.createdAt) }
        : {}),
    },
    unknownEffects: normalized.unknown,
    droppedEffects: normalized.dropped,
  };
}

/** Normalize the optional document-local Look collection. */
export function normalizeEffectLooks(value: unknown): EffectLook[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => normalizeEffectLook(entry, 'document', index).look)
    .filter((entry): entry is EffectLook => entry !== null);
}

/** Build a portable Look from a current stack without sharing its objects. */
export function createEffectLook(
  id: string,
  name: string,
  effects: readonly Adjustment[],
  description?: string,
): EffectLook {
  const cloned = effects.map((effect) => {
    if (!isKnownAdjustmentKind(effect.kind)) return { ...effect } as Adjustment;
    const defaults = adjustmentDefaults(effect.kind);
    return makeAdjustment(effect.id, effect.kind, {
      ...defaults,
      ...JSON.parse(JSON.stringify(effect)),
    });
  });
  return {
    id,
    schemaVersion: 1,
    name: boundedText(name, 'Untitled Look', 120),
    ...(description ? { description: description.trim().slice(0, 500) } : {}),
    effects: cloned,
    createdAt: Date.now(),
  };
}

/** Append a Look to a stack with fresh effect IDs and preserved ordering. */
export function appendEffectLook(
  stack: readonly Adjustment[],
  look: EffectLook,
  makeId: () => string,
): Adjustment[] {
  return [
    ...stack,
    ...look.effects.map((effect) => {
      const id = makeId();
      const { id: _sourceId, kind: _sourceKind, ...parameters } = effect;
      return isKnownAdjustmentKind(effect.kind)
        ? makeAdjustment(id, effect.kind, JSON.parse(JSON.stringify(parameters)))
        : ({ ...effect, id } as Adjustment);
    }),
  ];
}

/**
 * Shared property-state vocabulary for Inspector controls.
 *
 * Selection aggregation is intentionally separate from document ownership:
 * this is a derived view model, never a second source of document state. The
 * richer states are available to controls as the rest of the Inspector is
 * migrated away from boolean `mixed` flags.
 */

export type InspectorPropertyState<T> =
  | {
      kind: 'common';
      value: T;
      applicableCount: number;
    }
  | {
      kind: 'mixed';
      representative?: T;
      applicableCount: number;
      distinctCount: number;
    }
  | {
      kind: 'unset';
      applicableCount: number;
    }
  | {
      kind: 'partially-applicable';
      representative?: T;
      applicableCount: number;
      totalCount: number;
      mixed: boolean;
    }
  | {
      kind: 'inherited';
      value: T;
      sourceId: string;
    }
  | {
      kind: 'overridden';
      value: T;
      sourceId: string;
    }
  | {
      kind: 'bound';
      value: T;
      bindingId: string;
      overridden?: boolean;
    }
  | {
      kind: 'calculated';
      value: T;
      description: string;
    }
  | {
      kind: 'unavailable';
      reason: string;
      applicableCount: number;
      totalCount?: number;
    }
  | {
      kind: 'invalid';
      message: string;
      value?: T;
    }
  | {
      kind: 'pending';
      value?: T;
      message?: string;
    }
  | {
      kind: 'error';
      message: string;
      value?: T;
    };

export type SelectionPropertyState<T> = Extract<
  InspectorPropertyState<T>,
  { kind: 'common' | 'mixed' | 'unset' | 'partially-applicable' | 'unavailable' }
>;

export interface SelectionPropertyOptions<T> {
  /** Total selection size, when the accessor only applies to a subset. */
  totalCount?: number;
  equals?: (a: T, b: T) => boolean;
}

/** Structural equality used by Inspector aggregate values. */
export function samePropertyValue<T>(a: T, b: T): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => samePropertyValue(value, b[index]));
  }
  if (a instanceof Object && b instanceof Object) {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => samePropertyValue(aRecord[key], bRecord[key]))
    );
  }
  // Keep numeric equality aligned with the legacy selection helper: -0 and 0
  // are the same Inspector value, while NaN remains invalid/non-common.
  return a === b;
}

/**
 * Classify values for a property across a selection without retaining all
 * values. This keeps large selections bounded while preserving the useful
 * representative value for controls that need a numeric fallback.
 */
export function classifySelectionProperty<T>(
  values: readonly T[],
  options: SelectionPropertyOptions<T> = {},
): SelectionPropertyState<T> {
  const totalCount = Math.max(options.totalCount ?? values.length, values.length);
  const applicableCount = values.length;
  if (applicableCount === 0 || totalCount === 0) {
    return {
      kind: 'unavailable',
      reason: 'No selected objects support this property',
      applicableCount: 0,
      totalCount,
    };
  }

  const equals = options.equals ?? samePropertyValue;
  const first = values[0] as T;
  const allUnset = values.every((value) => value === undefined);
  if (allUnset) return { kind: 'unset', applicableCount };

  const allEqual = values.every((value) => equals(value, first));
  if (applicableCount < totalCount) {
    return {
      kind: 'partially-applicable',
      representative: first,
      applicableCount,
      totalCount,
      mixed: !allEqual,
    };
  }
  if (allEqual) return { kind: 'common', value: first, applicableCount };

  let distinctCount = 1;
  const representatives: T[] = [first];
  for (const value of values.slice(1)) {
    if (representatives.every((representative) => !equals(value, representative))) {
      representatives.push(value);
      distinctCount += 1;
    }
  }
  return { kind: 'mixed', representative: first, applicableCount, distinctCount };
}

/** Accessible explanation for non-literal property states. */
export function describePropertyState<T>(state: InspectorPropertyState<T>): string | undefined {
  switch (state.kind) {
    case 'mixed':
      return 'Mixed values';
    case 'unset':
      return 'Unset';
    case 'partially-applicable':
      return `${state.applicableCount} of ${state.totalCount} selected objects support this property`;
    case 'inherited':
      return 'Inherited value';
    case 'overridden':
      return 'Local override';
    case 'bound':
      return state.overridden ? 'Bound value with local override' : 'Variable-bound value';
    case 'calculated':
      return `Calculated value: ${state.description}`;
    case 'unavailable':
      return state.reason;
    case 'invalid':
    case 'error':
      return state.message;
    case 'pending':
      return state.message ?? 'Processing';
    case 'common':
      return undefined;
  }
}

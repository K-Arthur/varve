/**
 * Variable store with modes + aliases + math expressions (Strata plan §3.1,
 * priority 8.0). Stubbed for task 0.8; full math resolution lands in task 1.2.
 *
 * Design intent: `{base} * 1.5` and `{space-2} + 4` resolve via alias lookup +
 * a safe arithmetic evaluator, with mode-aware overrides (e.g. compact/dense).
 * Variables are batch-editable across a multi-selection (task 1.2).
 */
export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export type VariableValue = string | number | boolean;

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  /** Per-mode values: { default: 4, dense: 3 }. */
  valuesByMode: Record<string, VariableValue>;
}

export interface VariableStore {
  variables: Record<string, Variable>;
  modes: string[];
  activeMode: string;
}

export function createVariableStore(modes = ['default']): VariableStore {
  return { variables: {}, modes, activeMode: modes[0] ?? 'default' };
}

/**
 * Resolve a variable's value for the active mode. Does NOT yet evaluate `{a} *
 * 1.5` math expressions or alias references — that is task 1.2 (which adds a
 * safe expression evaluator). Throws on unknown ids/names.
 */
export function resolve(store: VariableStore, nameOrId: string): VariableValue {
  const v =
    store.variables[nameOrId] ?? Object.values(store.variables).find((x) => x.name === nameOrId);
  if (!v) throw new Error(`unknown variable: ${nameOrId}`);
  const byMode =
    v.valuesByMode[store.activeMode] ??
    v.valuesByMode.default ??
    v.valuesByMode[store.modes[0] ?? 'default'];
  if (byMode === undefined) throw new Error(`no value for variable: ${nameOrId}`);
  return byMode;
}

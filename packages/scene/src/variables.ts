/**
 * Variable store with modes + aliases + math expressions (Strata plan §3.1,
 * priority 8.0).
 *
 * `resolve()` evaluates `{base} * 1.5` and `{space-2} + 4` via the safe
 * expression evaluator (expr.ts), with mode-aware overrides.
 * Variables are batch-editable across a multi-selection.
 *
 * Research basis: Figma variables / Tokens Studio math. The evaluator is a
 * Pratt parser (expr.ts) — no `eval`, no `Function`, no loops.
 */
import { evaluate } from './expr';
import type { PropertyBinding } from './types';

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
 * Resolve a variable's value for the active mode.
 * Evaluates `{alias}` references and math expressions (`{base} * 1.5`) using
 * the safe Pratt parser. Throws on unknown identifiers or syntax errors.
 */
export function resolve(store: VariableStore, nameOrId: string): VariableValue {
  const v =
    store.variables[nameOrId] ?? Object.values(store.variables).find((x) => x.name === nameOrId);
  if (!v) throw new Error(`unknown variable: ${nameOrId}`);
  const raw =
    v.valuesByMode[store.activeMode] ??
    v.valuesByMode.default ??
    v.valuesByMode[store.modes[0] ?? 'default'];
  if (raw === undefined) throw new Error(`no value for variable: ${nameOrId}`);

  if (typeof raw === 'string' && raw.includes('{')) {
    const aliases = collectAliases(store, raw);
    return evaluate(raw, aliases);
  }

  return raw;
}

/**
 * Recursively collect numeric alias values referenced in an expression.
 * Throws if any alias is not a number.
 */
function collectAliases(store: VariableStore, expr: string): Record<string, number> {
  const aliases: Record<string, number> = {};
  const visited = new Set<string>();

  function walk(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const resolved = resolve(store, name);
    if (typeof resolved !== 'number') {
      throw new Error(`Alias '${name}' must be numeric for math, got ${typeof resolved}`);
    }
    aliases[name] = resolved;
  }

  const matches = expr.match(/\{([^}]+)\}/g);
  if (matches) {
    for (const m of matches) {
      walk(m.slice(1, -1));
    }
  }

  return aliases;
}

export function resolveBinding(store: VariableStore, binding: PropertyBinding): VariableValue {
  const baseValue = resolve(store, binding.variableId);
  if (binding.expression && typeof baseValue === 'number') {
    const aliases: Record<string, number> = { [binding.variableId]: baseValue };
    const expr = binding.expression;
    const matches = expr.match(/\{([^}]+)\}/g);
    if (matches) {
      for (const m of matches) {
        const alias = m.slice(1, -1);
        if (!(alias in aliases)) {
          try {
            const resolved = resolve(store, alias);
            if (typeof resolved === 'number') aliases[alias] = resolved;
          } catch {
            // ignore unresolvable aliases in expression
          }
        }
      }
    }
    return evaluate(expr, aliases);
  }
  return baseValue;
}

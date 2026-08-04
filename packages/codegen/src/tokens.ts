/**
 * Token-aware codegen helpers — resolves variable bindings to token names
 * for use in generated code output (CSS custom properties, Tailwind, etc.).
 */

import type { PropertyBinding, VariableStore } from '@varve/scene';

export function resolveTokenName(
  bindings: Record<string, PropertyBinding> | undefined,
  property: string,
  store: VariableStore | undefined,
): string | undefined {
  if (!bindings || !store) return undefined;
  const binding = bindings[property];
  if (!binding) return undefined;
  const variable = store.variables[binding.variableId];
  if (!variable) return undefined;
  return variable.name;
}

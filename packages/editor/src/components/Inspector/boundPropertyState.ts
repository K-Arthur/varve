/**
 * Derived presentation for numeric variable bindings in the Inspector.
 *
 * The document binding remains authoritative. This helper only resolves the
 * value for display and chooses a safe editing policy; it never mutates the
 * document or creates Inspector-local property state.
 */
import { resolveBinding, type SceneNode, type VariableStore } from '@varve/scene';
import type { InspectorPropertyState } from './propertyState';

export interface NumericBindingPresentation {
  state: Extract<InspectorPropertyState<number>, { kind: 'bound' | 'error' | 'unavailable' }>;
  /** Value to display while the binding is active or cannot be resolved. */
  value: number;
  /** Variable name, or its stable ID when the source is missing. */
  sourceLabel: string;
  /** Bound properties are read-only until the user explicitly unbinds them. */
  readOnly: true;
}

/**
 * Resolve one numeric binding without allowing a batch edit to mutate only a
 * subset of selected nodes. A multi-selection containing any binding is
 * deliberately unavailable until its scope is made explicit by unbinding.
 */
export function deriveNumericBindingPresentation(
  nodes: readonly SceneNode[],
  property: string,
  rawValues: readonly number[],
  store: VariableStore,
): NumericBindingPresentation | undefined {
  const bound = nodes.filter((node) => Boolean(node.bindings?.[property]));
  if (bound.length === 0) return undefined;

  const fallback = rawValues[0] ?? 0;
  if (nodes.length !== 1) {
    return {
      state: {
        kind: 'unavailable',
        reason: `${bound.length} of ${nodes.length} selected objects are bound to variables; unbind before batch editing`,
        applicableCount: nodes.length - bound.length,
        totalCount: nodes.length,
      },
      value: fallback,
      sourceLabel: `${bound.length} variable-bound objects`,
      readOnly: true,
    };
  }

  const node = nodes[0];
  const binding = node?.bindings?.[property];
  if (!binding) return undefined;
  const sourceLabel = store.variables[binding.variableId]?.name ?? binding.variableId;

  try {
    const resolved = resolveBinding(store, binding);
    if (typeof resolved !== 'number' || !Number.isFinite(resolved)) {
      return {
        state: {
          kind: 'error',
          message: `Variable “${sourceLabel}” did not resolve to a finite number`,
          value: fallback,
        },
        value: fallback,
        sourceLabel,
        readOnly: true,
      };
    }
    return {
      state: { kind: 'bound', value: resolved, bindingId: binding.variableId },
      value: resolved,
      sourceLabel,
      readOnly: true,
    };
  } catch {
    return {
      state: {
        kind: 'error',
        message: `Variable “${sourceLabel}” could not be resolved; unbind it to edit a literal value`,
        value: fallback,
      },
      value: fallback,
      sourceLabel,
      readOnly: true,
    };
  }
}

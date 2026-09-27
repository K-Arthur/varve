/** Shared Variable shapes. This leaf module keeps projection and store operations acyclic. */
export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export type VariableValue = string | number | boolean | Record<string, unknown>;

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  valuesByMode: Record<string, VariableValue>;
}

/**
 * A group of variables within a collection. Supports nesting.
 */
export interface VariableGroup {
  id: string;
  name: string;
  variableIds: string[];
  groups?: VariableGroup[];
}

/**
 * A collection groups related variables with their own mode list.
 * This is the Figma-equivalent organizational layer.
 */
export interface VariableCollection {
  id: string;
  name: string;
  modes: string[];
  activeMode: string;
  variableIds: string[];
  groups?: VariableGroup[];
}

export interface VariableStore {
  /** All variables across all collections (flat map for fast lookup). */
  variables: Record<string, Variable>;
  /** Named collections of variables. */
  collections: Record<string, VariableCollection>;
  /** The currently active collection id. */
  activeCollectionId: string;
  /** Backward-compat: global modes list. */
  modes: string[];
  /** Backward-compat: global active mode. */
  activeMode: string;
  /**
   * Design-token synchronization state (schema v1, ADR-0100).
   * Optional additive field: absent for legacy documents, survives the
   * document codec round trip because serialization spreads the document.
   */
  tokenSync?: import('./tokens/model').TokenSynchronization;
}

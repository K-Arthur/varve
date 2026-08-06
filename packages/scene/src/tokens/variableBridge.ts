/**
 * Bridge between DesignTokenRecord and the existing VariableStore
 * (ADR-0101).
 *
 * Variables stay the binding surface: PropertyBinding.variableId continues
 * to reference a Variable; a synchronized token owns (or maps to) backing
 * variables. The bridge:
 *
 * - materializes variable values from token values (per mode),
 * - derives token values from variable values (per mode),
 * - never converts Varve math expressions into DTCG aliases (they stay in
 *   the variable expression field or the org.varve.* extension).
 */

import type { Variable, VariableStore, VariableValue } from '../variables';
import { type DesignTokenRecord, type DesignTokenStore, pathKey } from './model';
import { linkVariable, unlinkVariable } from './store';

export const VARVE_EXTENSION_NAMESPACE = 'org.varve';

export interface TokenToVariableResult {
  variableId: string;
  variable: Omit<Variable, 'id'>;
  mode: string;
  /** True when the variable value is a Varve math expression, which must
   * NOT be exported as a DTCG reference. */
  portabilityWarning?: boolean;
}

/**
 * Convert a token's value for one mode into a variable value.
 * Reference strings and math-expression strings pass through untouched —
 * conversion into graph-backed references happens at import/apply time via
 * the DTCG pipeline, never here.
 */
export function tokenValueToVariableValue(value: unknown): VariableValue {
  return value as VariableValue;
}

/**
 * Create a backing variable for a token (one per mode context).
 * Name = last path segment; values = { [mode]: value }.
 */
export function tokenToVariable(
  token: DesignTokenRecord,
  mode: string,
): { variableId: string; variable: Omit<Variable, 'id'> } {
  const displayName = token.path[token.path.length - 1] ?? token.displayName;
  return {
    variableId: token.id, // bindings reference the token id via the bridge
    variable: {
      name: displayName,
      type: variableTypeForToken(token.type),
      valuesByMode: { [mode]: tokenValueToVariableValue(token.value) },
    },
  };
}

/** Map a DTCG token type onto the closest variable type. */
export function variableTypeForToken(tokenType: string): 'color' | 'number' | 'string' | 'boolean' {
  switch (tokenType) {
    case 'color':
    case 'fontFamily':
    case 'fontWeight':
      return 'string';
    case 'dimension':
    case 'duration':
    case 'number':
    case 'cubicBezier':
      return 'number';
    default:
      return 'string';
  }
}

/**
 * Link a token to its backing variable. Unlinks any previous link for the
 * variable (one variable maps to one token).
 */
export function bindVariableToToken(
  store: DesignTokenStore,
  variableId: string,
  tokenId: string,
): DesignTokenStore {
  let next = store;
  for (const [vid, tid] of Object.entries(store.variableLinks)) {
    if (tid === tokenId && vid !== variableId) next = unlinkVariable(next, vid);
  }
  return linkVariable(next, variableId, tokenId as `tok_${string}`);
}

/**
 * Find the backing token for a variable id, if any.
 */
export function tokenForVariable(store: DesignTokenStore, variableId: string) {
  const tokenId = store.variableLinks[variableId];
  if (!tokenId) return undefined;
  return store.tokens[tokenId as `tok_${string}`];
}
/** True when a variable is backed by a synchronized token. */
export function isSynchronizedVariable(store: DesignTokenStore, variableId: string): boolean {
  return store.variableLinks[variableId] !== undefined;
}

/**
 * Sanitize a candidate DTCG token name into a legal Varve variable name.
 * Varve variable names have no DTCG character restrictions; this only
 * guards against empty names.
 */
export function safeVariableName(name: string): string {
  return name.trim().length > 0 ? name : 'untitled';
}

export function tokenDisplayName(token: DesignTokenRecord): string {
  return token.displayName || pathKey(token.path);
}

/** Detach a token from its source (convert to local) — ADR-0110 option. */
export function detachTokenRecord(token: DesignTokenRecord): DesignTokenRecord {
  return {
    ...token,
    source: undefined,
    localState: {
      createdLocally: false,
      detachedFromSource: true,
      locallyModified: token.localState.locallyModified,
      unresolved: false,
      conflicted: false,
    },
  };
}

/** Compare two stores for token-level changes (fast path for diffing). */
export function changedTokenIds(
  base: DesignTokenStore | undefined,
  next: DesignTokenStore | undefined,
): Set<string> {
  const changed = new Set<string>();
  if (base === next) return changed;
  const a = base?.tokens ?? {};
  const b = next?.tokens ?? {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[id as `tok_${string}`] !== b[id as `tok_${string}`]) changed.add(id);
  }
  return changed;
}

export function hasStableVarveId(extensions: Record<string, unknown>): boolean {
  const ns = extensions[VARVE_EXTENSION_NAMESPACE] as Record<string, unknown> | undefined;
  return typeof ns?.id === 'string';
}

export function stableVarveId(extensions: Record<string, unknown>): string | undefined {
  const ns = extensions[VARVE_EXTENSION_NAMESPACE] as Record<string, unknown> | undefined;
  return typeof ns?.id === 'string' ? (ns.id as string) : undefined;
}

export function attachStableVarveId(
  extensions: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  const ns = { ...((extensions[VARVE_EXTENSION_NAMESPACE] as Record<string, unknown>) ?? {}), id };
  return { ...extensions, [VARVE_EXTENSION_NAMESPACE]: ns };
}

export type { VariableStore };

/**
 * Synchronization application (ADR-0108 D3, ADR-0116).
 *
 * Applies a validated TokenMergePlan to the DesignTokenStore and the
 * VariableStore bridge as one coherent, reversible document transaction:
 * - resolved merges become token records (path/type/value/metadata),
 * - renames preserve token ids (bindings stay intact),
 * - backing variables are created/updated for changed tokens,
 * - the source sync state advances (base revision) ONLY for applied
 *   changes; the caller commits the whole thing through updateDoc.
 *
 * External files are never written here (ADR-0112 owns that).
 */
import type { TokenMerge, TokenMergePlan } from '@varve/tokens';
import type { VariableStore } from '../../variables';
import type { DesignTokenRecord, DesignTokenStore, TokenSynchronization } from './model';
import { addToken, createEmptyTokenSynchronization, updateToken } from './store';
import { bindVariableToToken } from './variableBridge';

export interface SyncApplyResult {
  sync: TokenSynchronization;
  variables: VariableStore | undefined;
  /** Variable ids created or updated. */
  touchedVariableIds: string[];
  applied: number;
  skippedConflicts: number;
}

/**
 * Apply a merge plan to the token store and backing variables.
 * Conflicted merges are skipped (never auto-resolved). The result is a new
 * TokenSynchronization + VariableStore pair; the caller wraps it in one
 * updateDoc transaction.
 */
export function applyMergePlanToSync(
  sync: TokenSynchronization,
  variables: VariableStore | undefined,
  plan: TokenMergePlan,
  mode = 'default',
): SyncApplyResult {
  let store: DesignTokenStore = sync.store;
  const touchedVariableIds: string[] = [];
  let applied = 0;
  let skippedConflicts = 0;

  for (const merge of plan.merges) {
    if (merge.decision === 'conflict' || merge.decision === 'delete-vs-edit' || !merge.result) {
      skippedConflicts += 1;
      continue;
    }
    const result = merge.result;

    if (merge.decision === 'same-change' && merge.base && !changedFromBase(merge)) {
      continue;
    }

    if (result.id) {
      const existing = store.tokens[result.id as `tok_${string}`];
      if (existing) {
        const updated = updateToken(store, result.id as `tok_${string}`, {
          path: result.path,
          type: result.type ?? existing.type,
          value: result.value,
          description: result.description,
          deprecated: result.deprecated,
          extensions: result.extensions,
        });
        if (updated.diagnostics.length === 0) {
          store = updated.store;
          applied += 1;
        }
      } else {
        const record: DesignTokenRecord = {
          id: result.id as `tok_${string}`,
          path: result.path,
          displayName: result.path[result.path.length - 1] ?? 'untitled',
          type: result.type ?? 'string',
          value: result.value,
          description: result.description,
          deprecated: result.deprecated,
          extensions: result.extensions,
          localState: {
            createdLocally: false,
            detachedFromSource: false,
            locallyModified: false,
            unresolved: false,
            conflicted: false,
          },
        };
        const inserted = addToken(store, record);
        if (inserted.diagnostics.length === 0) {
          store = inserted.store;
          applied += 1;
        }
      }
    } else {
      // Identity-less tokens map by path.
      const existing = findTokenByPath(store, result.path);
      if (existing) {
        const updated = updateToken(store, existing.id, {
          value: result.value,
          type: result.type ?? existing.type,
        });
        if (updated.diagnostics.length === 0) {
          store = updated.store;
          applied += 1;
        }
      } else {
        const record: DesignTokenRecord = {
          id: mintLocalId(),
          path: result.path,
          displayName: result.path[result.path.length - 1] ?? 'untitled',
          type: result.type ?? 'string',
          value: result.value,
          extensions: result.extensions,
          localState: {
            createdLocally: true,
            detachedFromSource: true,
            locallyModified: false,
            unresolved: false,
            conflicted: false,
          },
        };
        const inserted = addToken(store, record);
        if (inserted.diagnostics.length === 0) {
          store = inserted.store;
          applied += 1;
        }
      }
    }

    // Backing variable for binding support (ADR-0101).
    if (variables) {
      const variableId = upsertBackingVariable(variables, store, merge, mode, touchedVariableIds);
      if (variableId) {
        store = bindVariableToToken(
          store,
          variableId,
          variableIdTokenId(store, merge) ?? lastTokenId(store),
        );
      }
    }
  }

  const syncState = sync;
  return {
    sync: { ...syncState, store, schemaVersion: sync.schemaVersion },
    variables,
    touchedVariableIds,
    applied,
    skippedConflicts,
  };
}

function changedFromBase(merge: {
  base?: { value?: unknown };
  local: { value?: unknown };
}): boolean {
  return JSON.stringify(merge.base?.value) !== JSON.stringify(merge.local.value);
}

function findTokenByPath(
  store: DesignTokenStore,
  path: readonly string[],
): DesignTokenRecord | undefined {
  const key = path.join('.');
  return Object.values(store.tokens).find((t) => t.path.join('.') === key);
}

function mintLocalId(): `tok_${string}` {
  const raw = globalThis.crypto?.randomUUID?.() ?? `local-${Math.random().toString(16).slice(2)}`;
  return `tok_${raw}` as `tok_${string}`;
}

function variableIdTokenId(store: DesignTokenStore, merge: { id?: string }): string | undefined {
  return merge.id;
}

function lastTokenId(store: DesignTokenStore): `tok_${string}` {
  const keys = Object.keys(store.tokens);
  return (keys[keys.length - 1] ?? mintLocalId()) as `tok_${string}`;
}

function upsertBackingVariable(
  variables: VariableStore,
  store: DesignTokenStore,
  merge: TokenMerge,
  mode: string,
  touched: string[],
): string | undefined {
  const value = merge.result?.value;
  if (value === undefined) return undefined;
  const name = merge.path[merge.path.length - 1] ?? 'untitled';
  const type =
    merge.result?.type === 'color' || merge.result?.type === 'fontFamily'
      ? 'string'
      : merge.result?.type === 'number' ||
          merge.result?.type === 'dimension' ||
          merge.result?.type === 'duration'
        ? 'number'
        : 'string';
  // Find an existing backing variable by token link.
  for (const [variableId, tokenId] of Object.entries(store.variableLinks)) {
    if (tokenId === merge.id) {
      variables.variables[variableId] = {
        ...variables.variables[variableId],
        valuesByMode: { ...(variables.variables[variableId]?.valuesByMode ?? {}), [mode]: value },
      };
      touched.push(variableId);
      return variableId;
    }
  }
  // Create a new backing variable with a collision-resistant id.
  const variableId = `var-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)}`;
  variables.variables[variableId] = {
    id: variableId,
    name,
    type: type as 'number' | 'string' | 'boolean' | 'color',
    valuesByMode: { [mode]: value },
  };
  touched.push(variableId);
  return variableId;
}

export { createEmptyTokenSynchronization };

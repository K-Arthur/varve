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
import type {
  DtcgDocument,
  DtcgGroupNode,
  DtcgTokenNode,
  TokenMerge,
  TokenMergePlan,
} from '@varve/tokens';
import type { VariableStore, VariableValue } from '../variables';
import { mintSourceId } from './identity';
import {
  createInitialSyncState,
  type DesignTokenRecord,
  type DesignTokenStore,
  type TokenGroupMeta,
  type TokenProvenance,
  type TokenSource,
  type TokenSourceId,
  type TokenSynchronization,
} from './model';
import { addSource, addToken, createEmptyTokenSynchronization, updateToken } from './store';
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
 * Backing-variable writes must never mutate the caller's store: the
 * previous document object is retained by the undo stack and shares the
 * same VariableStore reference, so an in-place write would make undo a
 * no-op for every variable an import created. One level of copying is
 * enough — the helpers below replace, never mutate, individual entries.
 */
function writableVariableStore(store: VariableStore | undefined): VariableStore | undefined {
  if (!store) return undefined;
  return { ...store, variables: { ...store.variables }, collections: { ...store.collections } };
}

/**
 * Apply a merge plan to the token store and backing variables.
 * Conflicted merges are skipped (never auto-resolved). The result is a new
 * TokenSynchronization + VariableStore pair; the caller wraps it in one
 * updateDoc transaction.
 */
export function applyMergePlanToSync(
  sync: TokenSynchronization,
  variablesInput: VariableStore | undefined,
  plan: TokenMergePlan,
  mode = 'default',
): SyncApplyResult {
  const variables = writableVariableStore(variablesInput);
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
          variableIdTokenId(merge) ?? lastTokenId(store),
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

function variableIdTokenId(merge: { id?: string }): string | undefined {
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
  if (value === undefined || value === null) return undefined;
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
      const existing = variables.variables[variableId];
      const valuesByMode = {
        ...(existing?.valuesByMode ?? {}),
        [mode]: value as VariableValue,
      };
      if (existing) {
        variables.variables[variableId] = { ...existing, valuesByMode };
      } else {
        variables.variables[variableId] = {
          id: variableId,
          name,
          type: type as 'number' | 'string' | 'boolean' | 'color',
          valuesByMode,
        };
      }
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
    valuesByMode: { [mode]: value as VariableValue },
  };
  touched.push(variableId);
  return variableId;
}

export interface ImportPreview {
  /** Tokens from the source document (path-keyed). */
  incoming: Map<string, TokenSnapshotView>;
  /** Tokens already in the store with the same path. */
  collisions: string[];
  added: number;
  /** Group-level metadata ($description/$deprecated/$extensions) by pathKey. */
  groups: Record<string, TokenGroupMeta>;
}

export interface TokenSnapshotView {
  path: string[];
  type?: string;
  value?: unknown;
  description?: string;
  deprecated?: boolean | string;
  extensions: Record<string, unknown>;
}

/**
 * A token written with a token-level `$ref` has no `$value` at all; the
 * reference itself is the authored content. Carry it through the store as
 * `{ $ref }` so export can replay the exact form instead of dropping the
 * token's value (format report §6.6.2 / §7.1.2).
 */
function tokenSnapshotValue(token: DtcgTokenNode): unknown {
  if (token.value !== undefined) return token.value;
  const pointerRef = token.references.find((r) => r.kind === 'json-pointer');
  return pointerRef ? { $ref: pointerRef.raw } : undefined;
}

/** Collect group metadata so it survives import → edit → export (ADR-0103). */
function collectGroupMeta(
  nodes: readonly (DtcgGroupNode | DtcgTokenNode)[],
  out: Record<string, TokenGroupMeta>,
): void {
  for (const node of nodes) {
    if (node.kind !== 'group') continue;
    const hasDescription = typeof node.description === 'string';
    const hasDeprecated = node.deprecated !== undefined;
    const hasExtensions = Object.keys(node.extensions ?? {}).length > 0;
    if (hasDescription || hasDeprecated || hasExtensions) {
      out[node.path.join('.')] = {
        ...(hasDescription ? { description: node.description } : {}),
        ...(hasDeprecated ? { deprecated: node.deprecated } : {}),
        extensions: node.extensions ?? {},
      };
    }
    collectGroupMeta(node.children, out);
  }
}

/**
 * Build a preview of importing a parsed DTCG document into the store:
 * which token paths are new, which collide with existing tokens.
 * Pure — the caller renders the preview and only then applies.
 */
export function previewImport(store: DesignTokenStore, document: DtcgDocument): ImportPreview {
  const incoming = new Map<string, TokenSnapshotView>();
  const collisions: string[] = [];
  for (const token of Object.values(document.tokens)) {
    const key = token.path.join('.');
    const existing = Object.values(store.tokens).find((t) => t.path.join('.') === key);
    if (existing) collisions.push(key);
    incoming.set(key, {
      path: token.path,
      type: token.type,
      value: tokenSnapshotValue(token),
      description: token.description,
      deprecated: token.deprecated,
      extensions: token.extensions,
    });
  }
  const groups: Record<string, TokenGroupMeta> = {};
  collectGroupMeta(document.groups, groups);
  return { incoming, collisions, added: incoming.size - collisions.length, groups };
}

export interface ImportApplyResult {
  sync: TokenSynchronization;
  variables: VariableStore | undefined;
  touchedVariableIds: string[];
  imported: number;
  skipped: number;
  diagnostics: string[];
}

/**
 * Apply an accepted import preview as one coherent transaction:
 * mint stable ids, record provenance, create backing variables, and mark
 * the source sync state clean. Callers wrap this in updateDoc.
 */
export function applyImportToSync(
  sync: TokenSynchronization,
  variablesInput: VariableStore | undefined,
  preview: ImportPreview,
  sourceId: string,
  specificationVersion: string,
  adapterId: string,
  mode = 'default',
): ImportApplyResult {
  const variables = writableVariableStore(variablesInput);
  let store: DesignTokenStore = sync.store;
  const source = store.sources[sourceId as `src_`];
  const touchedVariableIds: string[] = [];
  const diagnostics: string[] = [];
  let imported = 0;
  let skipped = 0;

  if (!source) {
    // Never mint provenance that points at a source which does not exist.
    return {
      sync,
      variables,
      touchedVariableIds,
      imported: 0,
      skipped: 0,
      diagnostics: [`unknown token source "${sourceId}" — nothing imported`],
    };
  }

  for (const view of preview.incoming.values()) {
    const key = view.path.join('.');
    const existing = Object.values(store.tokens).find((t) => t.path.join('.') === key);
    if (existing) {
      skipped += 1;
      diagnostics.push(`skipped existing token ${key}`);
      continue;
    }
    const provenance: TokenProvenance = {
      sourceId: sourceId as `src_${string}`,
      sourceFileId: sourceId,
      sourcePointer: `/${view.path.map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`,
      adapterId,
      specificationVersion,
      lastImportedValue: view.value,
      lastExternallyObservedValue: view.value,
    };
    const record: DesignTokenRecord = {
      id: mintImportId(),
      path: view.path,
      displayName: view.path[view.path.length - 1] ?? 'untitled',
      type: view.type ?? 'string',
      value: view.value,
      description: view.description,
      deprecated: view.deprecated,
      extensions: view.extensions,
      source: provenance,
      localState: {
        createdLocally: false,
        detachedFromSource: false,
        locallyModified: false,
        unresolved: false,
        conflicted: false,
      },
    };
    const inserted = addToken(store, record);
    if (inserted.diagnostics.length > 0) {
      skipped += 1;
      diagnostics.push(...inserted.diagnostics.map((d) => d.message));
      continue;
    }
    store = inserted.store;
    imported += 1;

    if (variables) {
      const variableId = createBackingVariable(variables, record, mode);
      store = bindVariableToToken(store, variableId, record.id);
      touchedVariableIds.push(variableId);
    }
  }

  if (source) {
    const syncState = {
      ...source.syncState,
      status: 'clean' as const,
      lastSyncAt: new Date().toISOString(),
      lastObservedRemoteRevision: 'import',
      lastAppliedLocalRevision: store.nextRevision,
    };
    store = { ...store, sources: { ...store.sources, [sourceId]: { ...source, syncState } } };
  }

  if (Object.keys(preview.groups).length > 0) {
    store = { ...store, groupMeta: { ...store.groupMeta, ...preview.groups } };
  }

  return {
    sync: { ...sync, store },
    variables,
    touchedVariableIds,
    imported,
    skipped,
    diagnostics,
  };
}

function mintImportId(): `tok_${string}` {
  const raw = globalThis.crypto?.randomUUID?.() ?? `import-${Math.random().toString(16).slice(2)}`;
  return `tok_${raw}` as `tok_${string}`;
}

function createBackingVariable(
  variables: VariableStore,
  record: DesignTokenRecord,
  mode: string,
): string {
  const variableId = `var-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)}`;
  const type =
    record.type === 'color' || record.type === 'fontFamily'
      ? 'string'
      : record.type === 'number' || record.type === 'dimension' || record.type === 'duration'
        ? 'number'
        : 'string';
  variables.variables[variableId] = {
    id: variableId,
    name: record.path[record.path.length - 1] ?? 'untitled',
    type: type as 'number' | 'string' | 'boolean' | 'color',
    valuesByMode: { [mode]: record.value as VariableValue },
  };
  return variableId;
}

export interface ImportSourceResolution {
  sync: TokenSynchronization;
  sourceId: TokenSourceId;
  /** True when the document had no token store at all before this call. */
  createdStore: boolean;
  createdSource: boolean;
}

/**
 * Resolve the destination source for an import, creating the token store
 * and/or the source when the document has none yet.
 *
 * First-use is a supported path: a fresh document has no `tokenSync` and no
 * sources, and an import must initialize both rather than refuse with
 * "no token source connected". The caller decides *which* source to target;
 * this function only guarantees the target exists.
 */
export function ensureImportSource(
  sync: TokenSynchronization | undefined,
  fileName: string,
  sourceId?: string,
): ImportSourceResolution {
  const base = sync ?? createEmptyTokenSynchronization();
  const createdStore = sync === undefined;
  const requested = sourceId as TokenSourceId | undefined;
  if (requested && base.store.sources[requested]) {
    return { sync: base, sourceId: requested, createdStore, createdSource: false };
  }
  const minted = mintSourceId();
  const source: TokenSource = {
    id: minted,
    name: fileName,
    kind: 'local-file',
    direction: 'import-only',
    adapterId: 'dtcg-2025.10',
    configuration: {
      entryFiles: [fileName],
      direction: 'import-only',
      stableIdPolicy: 'annotate',
    },
    syncState: createInitialSyncState(),
    connectedAt: new Date().toISOString(),
  };
  return {
    sync: { ...base, store: addSource(base.store, source) },
    sourceId: minted,
    createdStore,
    createdSource: true,
  };
}

export { createEmptyTokenSynchronization };

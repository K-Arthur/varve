/**
 * Immutable DesignTokenStore operations (ADR-0100 D1/D4).
 *
 * The store enforces:
 * - collision-resistant ids (never counters), validated on write
 * - unique paths within the store (duplicates rejected with a diagnostic)
 * - at most one owning source per token
 * - finite values, bounded sizes (resource limits)
 * - tombstoned deletion for source-owned tokens (ADR-0110)
 * - monotonic revisions for stale-plan rejection (ADR-0117)
 *
 * Every mutation returns a new store; documents remain immutable.
 */
import { isTokenId, mintTokenId, type TokenIdGenerator } from './identity';
import {
  type DesignTokenRecord,
  type DesignTokenStore,
  pathKey,
  TOKEN_STORE_SCHEMA_VERSION,
  type TokenBaseSnapshot,
  type TokenId,
  type TokenSource,
  type TokenSourceId,
  type TokenSynchronization,
  type TokenTombstone,
} from './model';

export const TOKEN_PATH_MAX_DEPTH = 64;
export const TOKEN_PATH_SEGMENT_MAX = 256;
export const TOKEN_EXTENSION_PAYLOAD_MAX = 1 << 20; // 1 MiB
export const TOKEN_STORE_MAX_TOKENS = 100_000;

export interface TokenStoreDiagnostic {
  code: string;
  message: string;
  pointer?: string;
}

export function createTokenStore(): DesignTokenStore {
  return {
    schemaVersion: TOKEN_STORE_SCHEMA_VERSION,
    tokens: {},
    sources: {},
    ownership: {},
    variableLinks: {},
    tombstones: {},
    bases: {},
    nextRevision: 'r1',
  };
}

export function createEmptyTokenSynchronization(): TokenSynchronization {
  return {
    schemaVersion: TOKEN_STORE_SCHEMA_VERSION,
    store: createTokenStore(),
    connections: {},
  };
}

export function nextStoreRevision(store: DesignTokenStore): string {
  const n = parseInt(store.nextRevision.slice(1), 10) || 0;
  return `r${n + 1}`;
}

function validateRecord(record: DesignTokenRecord): TokenStoreDiagnostic[] {
  const diagnostics: TokenStoreDiagnostic[] = [];
  if (!isTokenId(record.id)) {
    diagnostics.push({
      code: 'token.invalid-id',
      message: `Token id ${String(record.id)} is not a valid tok_ id`,
    });
  }
  if (record.path.length === 0) {
    diagnostics.push({ code: 'token.empty-path', message: `Token ${record.id} has an empty path` });
  }
  if (record.path.length > TOKEN_PATH_MAX_DEPTH) {
    diagnostics.push({
      code: 'token.path-too-deep',
      message: `Token ${record.id} exceeds max depth ${TOKEN_PATH_MAX_DEPTH}`,
    });
  }
  for (const segment of record.path) {
    if (segment.length === 0 || segment.length > TOKEN_PATH_SEGMENT_MAX) {
      diagnostics.push({
        code: 'token.invalid-path-segment',
        message: `Invalid path segment in token ${record.id}`,
      });
    }
  }
  if (!isFiniteValue(record.value)) {
    diagnostics.push({
      code: 'token.non-finite-value',
      message: `Token ${record.id} contains a non-finite value`,
    });
  }
  const extBytes = approximateJsonBytes(record.extensions);
  if (extBytes > TOKEN_EXTENSION_PAYLOAD_MAX) {
    diagnostics.push({
      code: 'token.extensions-too-large',
      message: `Token ${record.id} extensions exceed the payload limit`,
    });
  }
  return diagnostics;
}

function isFiniteValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 4096 && value.every(isFiniteValue);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).every(isFiniteValue);
  }
  return true;
}

function approximateJsonBytes(value: unknown): number {
  try {
    const raw = JSON.stringify(value);
    return typeof raw === 'string' ? raw.length : 0;
  } catch {
    return 0;
  }
}

export function addToken(
  store: DesignTokenStore,
  record: Omit<DesignTokenRecord, 'id'> & { id: TokenId },
): { store: DesignTokenStore; token: DesignTokenRecord; diagnostics: TokenStoreDiagnostic[] } {
  const diagnostics = validateRecord(record as DesignTokenRecord);
  if (store.tokens[record.id]) {
    diagnostics.push({
      code: 'token.duplicate-id',
      message: `Token id ${record.id} already exists`,
    });
  }
  const key = pathKey(record.path);
  const collision = Object.values(store.tokens).find((t) => pathKey(t.path) === key);
  if (collision) {
    diagnostics.push({
      code: 'token.duplicate-path',
      message: `Path ${key} is already used by token ${collision.id}`,
    });
  }
  if (Object.keys(store.tokens).length >= TOKEN_STORE_MAX_TOKENS) {
    diagnostics.push({
      code: 'token.store-full',
      message: `Token store limit (${TOKEN_STORE_MAX_TOKENS}) reached`,
    });
  }
  if (diagnostics.length > 0) {
    return { store, token: record as DesignTokenRecord, diagnostics };
  }
  const token = { ...record, extensions: { ...record.extensions } } as DesignTokenRecord;
  return {
    store: {
      ...store,
      tokens: { ...store.tokens, [token.id]: token },
      nextRevision: nextStoreRevision(store),
    },
    token,
    diagnostics,
  };
}

export function updateToken(
  store: DesignTokenStore,
  id: TokenId,
  patch: Partial<
    Pick<
      DesignTokenRecord,
      | 'path'
      | 'displayName'
      | 'type'
      | 'value'
      | 'description'
      | 'deprecated'
      | 'extensions'
      | 'localState'
    >
  >,
): { store: DesignTokenStore; token: DesignTokenRecord; diagnostics: TokenStoreDiagnostic[] } {
  const existing = store.tokens[id];
  if (!existing) {
    return {
      store,
      token: {} as DesignTokenRecord,
      diagnostics: [{ code: 'token.missing', message: `Token ${id} does not exist` }],
    };
  }
  const next = {
    ...existing,
    ...patch,
    extensions: patch.extensions ? { ...patch.extensions } : existing.extensions,
  } as DesignTokenRecord;
  if (patch.path) {
    const key = pathKey(patch.path);
    const collision = Object.entries(store.tokens).find(
      ([tid, t]) => tid !== id && pathKey(t.path) === key,
    );
    if (collision) {
      return {
        store,
        token: next,
        diagnostics: [
          {
            code: 'token.duplicate-path',
            message: `Path ${key} is already used by token ${collision[0]}`,
          },
        ],
      };
    }
  }
  const diagnostics = validateRecord(next);
  if (diagnostics.length > 0) {
    return { store, token: next, diagnostics };
  }
  return {
    store: {
      ...store,
      tokens: { ...store.tokens, [id]: next },
      nextRevision: nextStoreRevision(store),
    },
    token: next,
    diagnostics,
  };
}

export function renameToken(
  store: DesignTokenStore,
  id: TokenId,
  newPath: readonly string[],
): DesignTokenStore {
  const updated = updateToken(store, id, { path: newPath });
  if (updated.diagnostics.length > 0) return store;
  return updated.store;
}

export function deleteToken(
  store: DesignTokenStore,
  id: TokenId,
  opts?: {
    tombstone?: boolean;
    deletedBy?: 'local' | 'remote';
    baseRevision?: string;
    at?: string;
  },
): DesignTokenStore {
  const token = store.tokens[id];
  if (!token) return store;

  const tokens = { ...store.tokens };
  delete tokens[id];
  const ownership = { ...store.ownership };
  delete ownership[id];
  const variableLinks = { ...store.variableLinks };
  for (const [variableId, tokenId] of Object.entries(variableLinks)) {
    if (tokenId === id) delete variableLinks[variableId];
  }
  const bases = { ...store.bases };
  for (const [source, snapshot] of Object.entries(bases)) {
    if (snapshot.tokenHashes[id]) {
      const tokenHashes = { ...snapshot.tokenHashes };
      delete tokenHashes[id];
      bases[source as TokenSourceId] = { ...snapshot, tokenHashes };
    }
  }

  let tombstones = store.tombstones;
  if (opts?.tombstone) {
    const tombstone: TokenTombstone = {
      tokenId: id,
      path: token.path,
      deletedBy: opts.deletedBy ?? 'local',
      at: opts.at ?? new Date().toISOString(),
      baseRevision: opts.baseRevision,
    };
    tombstones = { ...tombstones, [id]: tombstone };
  }

  return {
    ...store,
    tokens,
    ownership,
    variableLinks,
    bases,
    tombstones,
    nextRevision: nextStoreRevision(store),
  };
}

export function addSource(store: DesignTokenStore, source: TokenSource): DesignTokenStore {
  if (store.sources[source.id]) return store;
  return { ...store, sources: { ...store.sources, [source.id]: source } };
}

export function updateSource(
  store: DesignTokenStore,
  sourceId: TokenSourceId,
  patch: Partial<TokenSource>,
): DesignTokenStore {
  const existing = store.sources[sourceId];
  if (!existing) return store;
  return { ...store, sources: { ...store.sources, [sourceId]: { ...existing, ...patch } } };
}

export function disconnectSource(
  store: DesignTokenStore,
  sourceId: TokenSourceId,
): DesignTokenStore {
  const existing = store.sources[sourceId];
  if (!existing) return store;
  return {
    ...store,
    sources: {
      ...store.sources,
      [sourceId]: { ...existing, syncState: { ...existing.syncState, status: 'disconnected' } },
    },
  };
}

export function claimOwnership(
  store: DesignTokenStore,
  tokenId: TokenId,
  sourceId: TokenSourceId,
): DesignTokenStore {
  const existingOwner = store.ownership[tokenId];
  if (existingOwner && existingOwner !== sourceId) {
    return store; // silent refusal; caller must surface the conflict
  }
  return { ...store, ownership: { ...store.ownership, [tokenId]: sourceId } };
}

export function linkVariable(
  store: DesignTokenStore,
  variableId: string,
  tokenId: TokenId,
): DesignTokenStore {
  if (!store.tokens[tokenId]) return store;
  return { ...store, variableLinks: { ...store.variableLinks, [variableId]: tokenId } };
}

export function unlinkVariable(store: DesignTokenStore, variableId: string): DesignTokenStore {
  const links = { ...store.variableLinks };
  delete links[variableId];
  return { ...store, variableLinks: links };
}

export function setBaseSnapshot(
  store: DesignTokenStore,
  snapshot: TokenBaseSnapshot,
): DesignTokenStore {
  return { ...store, bases: { ...store.bases, [snapshot.sourceId]: snapshot } };
}

export function clearBaseSnapshot(
  store: DesignTokenStore,
  sourceId: TokenSourceId,
): DesignTokenStore {
  const bases = { ...store.bases };
  delete bases[sourceId];
  return { ...store, bases };
}

// ── Queries / indexes ───────────────────────────────────────────────────────

/** O(1) path lookup. Returns the token whose canonical path matches. */
export function getTokenByPath(
  store: DesignTokenStore,
  path: readonly string[],
): DesignTokenRecord | undefined {
  const key = pathKey(path);
  return Object.values(store.tokens).find((t) => pathKey(t.path) === key);
}

/** O(n) path index builder — used after import; incremental indexes arrive
 * with the reference graph (ADR-0104/ADR-0121). */
export function indexTokensByPath(store: DesignTokenStore): Map<string, TokenId> {
  const index = new Map<string, TokenId>();
  for (const token of Object.values(store.tokens)) {
    index.set(pathKey(token.path), token.id);
  }
  return index;
}

export function tokensBySource(
  store: DesignTokenStore,
  sourceId: TokenSourceId,
): DesignTokenRecord[] {
  return Object.values(store.tokens).filter((t) => t.source?.sourceId === sourceId);
}

export function getTokenByVariable(
  store: DesignTokenStore,
  variableId: string,
): TokenId | undefined {
  return store.variableLinks[variableId];
}

export function mintToken(
  store: DesignTokenStore,
  record: Omit<DesignTokenRecord, 'id'>,
  generate?: TokenIdGenerator,
) {
  const id = mintTokenId(generate);
  const inserted = addToken(store, { ...record, id });
  return { ...inserted, tokenId: id };
}

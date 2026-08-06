/**
 * Canonical design-token model (ADR-0100).
 *
 * A design token's internal identity is a collision-resistant TokenId,
 * decoupled from its human-readable DTCG path. Every synchronized token
 * carries provenance (source, file, pointer, adapter, spec version) and
 * local state (created locally, detached, modified, unresolved, conflicted).
 *
 * Sync metadata is never serialized into exported token values; it lives in
 * the token store, which persists as an optional additive field on
 * VariableStore (ADR-0100 D1).
 */
export type TokenId = `tok_${string}`;

export type TokenSourceId = `src_${string}`;

/** DTCG token type names ("color", "dimension", …). Open string at the
 * store layer; closed by the DTCG version registry in @varve/tokens. */
export type DtcgTokenType = string;

/** Typed token value. Validated by the DTCG codecs before it enters the
 * store; the store itself only enforces finiteness and size bounds. */
export type TokenValue = unknown;

export type TokenSourceKind =
  | 'local-file'
  | 'local-directory'
  | 'git-working-tree'
  | 'read-only-url'
  | 'design-platform';

export type TokenSyncDirection = 'import-only' | 'export-only' | 'bidirectional';

export type TokenSyncStatus =
  | 'disconnected'
  | 'clean'
  | 'local-changes'
  | 'remote-changes'
  | 'diverged'
  | 'conflicted'
  | 'invalid'
  | 'unavailable';

export interface TokenProvenance {
  sourceId: TokenSourceId;
  sourceFileId: string;
  /** JSON Pointer into the source document (e.g. "/color/brand/primary"). */
  sourcePointer: string;
  /** Vendor/extension stable id when the adapter can supply one. */
  sourceStableId?: string;
  adapterId: string;
  specificationVersion: string;
  /** Last value seen at import time (base-relative). */
  lastImportedValue?: unknown;
  /** Last value observed from the source (remote-relative). */
  lastExternallyObservedValue?: unknown;
}

export interface TokenLocalState {
  createdLocally: boolean;
  detachedFromSource: boolean;
  locallyModified: boolean;
  unresolved: boolean;
  conflicted: boolean;
}

export interface DesignTokenRecord {
  id: TokenId;
  /** Human-readable DTCG path (group names + token name, $root included). */
  path: readonly string[];
  displayName: string;
  type: DtcgTokenType;
  value: TokenValue;
  description?: string;
  /** true | string explanation (DTCG $deprecated), false = explicit override. */
  deprecated?: boolean | string;
  /** Unknown $extensions preserved verbatim. */
  extensions: Record<string, unknown>;
  source?: TokenProvenance;
  localState: TokenLocalState;
}

export interface TokenSyncState {
  baseRevision?: string;
  baseSemanticHash?: string;
  baseSnapshotLocation?: string;
  lastObservedRemoteRevision?: string;
  lastAppliedLocalRevision?: string;
  lastSyncAt?: string;
  status: TokenSyncStatus;
}

export interface TokenSourceConfiguration {
  rootPath?: string;
  entryFiles: string[];
  resolverFile?: string;
  include?: string[];
  exclude?: string[];
  direction: TokenSyncDirection;
  /** Whether Varve may annotate the source with org.varve.* extensions. */
  stableIdPolicy: 'annotate' | 'read-only' | 'none';
  formatting?: Record<string, unknown>;
  platform?: Record<string, unknown>;
}

export interface TokenSource {
  id: TokenSourceId;
  name: string;
  kind: TokenSourceKind;
  direction: TokenSyncDirection;
  adapterId: string;
  configuration: TokenSourceConfiguration;
  syncState: TokenSyncState;
  connectedAt?: string;
}

/** Distinguishes "deleted" from "source unavailable" (ADR-0110). */
export interface TokenTombstone {
  tokenId: TokenId;
  path: readonly string[];
  deletedBy: 'local' | 'remote';
  at: string;
  baseRevision?: string;
}

/** Compact, versioned, recoverable base snapshot (ADR-0108 D4). */
export interface TokenBaseSnapshot {
  sourceId: TokenSourceId;
  schemaVersion: number;
  semanticHash: string;
  revision: string;
  capturedAt: string;
  /** Per-token semantic hashes for cheap three-way comparison. */
  tokenHashes: Record<TokenId, string>;
  sizeBytes?: number;
}

export const TOKEN_STORE_SCHEMA_VERSION = 1;

export interface DesignTokenStore {
  schemaVersion: number;
  tokens: Record<TokenId, DesignTokenRecord>;
  sources: Record<TokenSourceId, TokenSource>;
  /** tokenId → owning sourceId. At most one owning source per token. */
  ownership: Record<TokenId, TokenSourceId>;
  /** variableId to tokenId bridge map (ADR-0101). */
  variableLinks: Record<string, TokenId>;
  tombstones: Record<TokenId, TokenTombstone>;
  /** Per-source base snapshots. */
  bases: Record<TokenSourceId, TokenBaseSnapshot>;
  /** Monotonic revision token for stale-plan rejection (ADR-0117 D2). */
  nextRevision: string;
}

/** Versioned sync state persisted on VariableStore (ADR-0100 D1). */
export interface TokenSynchronization {
  schemaVersion: number;
  store: DesignTokenStore;
  /** Connection records reference sources by stable id; machine-local
   * configuration (paths, watcher state) stays outside the document. */
  connections: Record<TokenSourceId, { name: string; kind: TokenSourceKind }>;
}

export function createLocalTokenState(): TokenLocalState {
  return {
    createdLocally: true,
    detachedFromSource: false,
    locallyModified: false,
    unresolved: false,
    conflicted: false,
  };
}

export function createImportedTokenState(): TokenLocalState {
  return {
    createdLocally: false,
    detachedFromSource: false,
    locallyModified: false,
    unresolved: false,
    conflicted: false,
  };
}

export function createInitialSyncState(): TokenSyncState {
  return { status: 'disconnected' };
}

export function pathKey(path: readonly string[]): string {
  return path.join('.');
}

/**
 * Pure import workflow for the Token Sync panel (ADR-0107/0108).
 *
 * Everything here is deterministic and framework-free: format detection,
 * parsing, preview construction, source resolution, and import planning.
 * The panel owns only rendering and event wiring, so the reviewed preview
 * and the applied document are the same object by construction — there is
 * no cache, no re-read, and no session-global state to go stale.
 */
import type { Document, VariableStore } from '@varve/scene';
import {
  applyImportToSync,
  applyMergePlanToSync,
  createEmptyTokenSynchronization,
  ensureImportSource,
  formatDocumentFromTokenRecords,
  planSourceUpdate,
  previewImport,
  projectTokenValue,
  type SourceUpdateConflict,
  type TokenSynchronization,
  tokensBySource,
} from '@varve/scene/tokens';
import {
  buildReferenceGraph,
  type ConflictResolutionChoice,
  type DtcgDocument,
  deepEqual,
  JsonSyntaxError,
  parseFormatDocument,
  parseJsonSource,
  parseResolverDocument,
  type ResolverDocument,
  type ResolverInput,
  resolveFormatTokenValue,
  resolvePermutation,
  snapshotFromDocument,
  type TokenDiagnostic,
  validateResolvedTokenValues,
} from '@varve/tokens';
import { docVariableStore } from '../docVariableStore';

/** Sentinel option value: target a source that does not exist yet. */
export const NEW_SOURCE_OPTION = '__new_source__';

/** Specification + adapter identity recorded on every applied import. */
export const IMPORT_SPECIFICATION_VERSION = '2025.10';
export const IMPORT_ADAPTER_ID = 'dtcg-2025.10';

export interface PreviewFileIdentity {
  name: string;
  size: number;
  lastModified: number;
}

export interface PreviewDiagnostic {
  severity: TokenDiagnostic['severity'];
  code: string;
  message: string;
  sourceFileId?: string;
  pointer?: string;
  line?: number;
  column?: number;
}

export interface ImportPreviewState {
  kind: 'dtcg' | 'resolver' | 'invalid';
  /** Display identity of the reviewed file. */
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  /** FNV-1a content hash — the identity of the reviewed revision. */
  textHash: string;
  /** Extra files offered alongside the primary one (resolver $ref corpus). */
  siblingCount: number;
  /** Diagnostics produced while parsing, before any resolution step. */
  parseDiagnostics: PreviewDiagnostic[];
  /** Parse diagnostics plus resolution diagnostics; drives error gating. */
  diagnostics: PreviewDiagnostic[];
  /** Tokens a successful apply would add. 0 disables the Apply action. */
  added: number;
  /** Existing token paths the import would skip. */
  collisions: string[];
  /** The exact parsed document under review; undefined while unusable. */
  document?: DtcgDocument;
  resolver?: ResolverDocument;
  resolverInput?: ResolverInput;
}

export interface ImportPlan {
  variableStore: VariableStore;
  sourceId: string;
  createdSource: boolean;
  createdStore: boolean;
  imported: number;
  skipped: number;
  diagnostics: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** FNV-1a — stable, synchronous, and cheap; used to pin the reviewed bytes. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Route a file by its content first; the `.resolver.json` extension is only
 * a tie-breaker for otherwise ambiguous documents.
 */
export function detectDocumentKind(text: string, fileName = ''): 'resolver' | 'dtcg' | 'invalid' {
  let root: unknown;
  try {
    root = parseJsonSource(text).value;
  } catch {
    return 'invalid';
  }
  if (!isPlainObject(root)) return 'invalid';
  const looksLikeResolver =
    Array.isArray(root.resolutionOrder) ||
    (typeof root.version === 'string' &&
      ('sets' in root || 'modifiers' in root || 'sources' in root));
  if (looksLikeResolver) return 'resolver';
  if (fileName.endsWith('.resolver.json') && !containsToken(root)) return 'resolver';
  return 'dtcg';
}

function mapDiagnostics(diagnostics: readonly TokenDiagnostic[]): PreviewDiagnostic[] {
  return diagnostics.map((d) => ({
    ...d,
    // Ambiguous duplicate keys are retained for recovery by the standards
    // parser, but the editor's import profile never applies a chosen winner.
    severity: d.code === 'json.duplicate-key' ? 'error' : d.severity,
  }));
}

function containsToken(root: Record<string, unknown>): boolean {
  if ('$value' in root || '$ref' in root) return true;
  return Object.values(root).some((value) => isPlainObject(value) && containsToken(value));
}

function hasError(diagnostics: readonly PreviewDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

/** First selectable context for every modifier that has one. */
export function defaultResolverInput(resolver: ResolverDocument): ResolverInput {
  const input: ResolverInput = {};
  for (const modifier of Object.values(resolver.modifiers)) {
    const contexts = Object.keys(modifier.contexts);
    if (contexts.length === 0) continue;
    input[modifier.name] =
      modifier.default !== undefined && contexts.includes(modifier.default)
        ? modifier.default
        : (contexts[0] as string);
  }
  return input;
}

function buildSiblingLoader(
  siblings: ReadonlyMap<string, string>,
  diagnostics: PreviewDiagnostic[],
) {
  if (siblings.size === 0) return undefined;
  return (ref: string): Record<string, unknown> | undefined => {
    const local = ref.replace(/^\.\//, '');
    if (/^[a-z][a-z\d+.-]*:|^\/|\\/i.test(local) || local.split('/').includes('..')) {
      diagnostics.push({
        severity: 'error',
        code: 'source.unavailable-reference',
        message: `${ref}: this picker accepts only explicitly supplied relative files.`,
      });
      return undefined;
    }
    const text = siblings.get(local);
    if (text === undefined) return undefined;
    try {
      const parsed = parseJsonSource(text);
      for (const diagnostic of parsed.diagnostics) {
        diagnostics.push({
          severity: 'error',
          code: `source.${diagnostic.code}`,
          message: `${local}: ${diagnostic.message}`,
        });
      }
      return parsed.diagnostics.length === 0 && isPlainObject(parsed.value)
        ? parsed.value
        : undefined;
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'source.json',
        message: `${local}: ${error instanceof Error ? error.message : 'Invalid JSON source.'}`,
      });
      return undefined;
    }
  };
}

function emptySyncForPreview(sync: TokenSynchronization | undefined): TokenSynchronization {
  return sync ?? createEmptyTokenSynchronization();
}

/** Compare the incoming document against the store; missing sync = all new. */
function attachTokenPreview(
  state: ImportPreviewState,
  sync: TokenSynchronization | undefined,
): ImportPreviewState {
  if (!state.document) return state;
  const incoming = previewImport(emptySyncForPreview(sync).store, state.document);
  return { ...state, added: incoming.added, collisions: incoming.collisions };
}

/**
 * Build the reviewed preview for a picked file. Never applies anything and
 * never mutates the store.
 */
export function buildImportPreview(
  text: string,
  identity: PreviewFileIdentity,
  sync: TokenSynchronization | undefined,
  siblings: ReadonlyMap<string, string> = new Map(),
): ImportPreviewState {
  const base = {
    fileName: identity.name,
    fileSize: identity.size,
    fileLastModified: identity.lastModified,
    textHash: hashText(text),
    siblingCount: siblings.size,
  };
  const kind = detectDocumentKind(text, identity.name);

  if (kind === 'invalid') {
    let syntaxError: JsonSyntaxError | undefined;
    try {
      parseJsonSource(text);
    } catch (error) {
      if (error instanceof JsonSyntaxError) syntaxError = error;
    }
    const diagnostics: PreviewDiagnostic[] = [
      {
        severity: 'error',
        code: syntaxError?.code ?? 'json.syntax',
        message:
          syntaxError?.message ?? `${identity.name} is not a JSON object and cannot be imported.`,
        sourceFileId: identity.name,
        line: syntaxError?.line,
        column: syntaxError?.column,
      },
    ];
    return {
      kind,
      ...base,
      parseDiagnostics: diagnostics,
      diagnostics,
      added: 0,
      collisions: [],
    };
  }

  if (kind === 'resolver') {
    const resolver = parseResolverDocument(text, identity.name);
    const parseDiagnostics = [
      ...mapDiagnostics(resolver.diagnostics),
      ...parseJsonSource(text).diagnostics.map((diagnostic) => ({
        severity: 'error' as const,
        code: `json.${diagnostic.code}`,
        message: diagnostic.message,
        sourceFileId: identity.name,
        line: diagnostic.line,
        column: diagnostic.column,
      })),
    ];
    const preview: ImportPreviewState = {
      kind,
      ...base,
      parseDiagnostics,
      diagnostics: parseDiagnostics,
      added: 0,
      collisions: [],
      resolver,
      resolverInput: defaultResolverInput(resolver),
    };
    if (hasError(parseDiagnostics)) return preview;
    return resolveResolverPreview(preview, preview.resolverInput as ResolverInput, sync, siblings);
  }

  const document = parseFormatDocument(text, { sourceFileId: identity.name });
  const diagnostics = mapDiagnostics([
    ...document.diagnostics,
    ...buildReferenceGraph(document).diagnostics,
    ...validateResolvedTokenValues(document),
  ]);
  const preview: ImportPreviewState = {
    kind,
    ...base,
    parseDiagnostics: diagnostics,
    diagnostics,
    added: 0,
    collisions: [],
    document: hasError(diagnostics) ? undefined : document,
  };
  return attachTokenPreview(withBindingDiagnostics(preview), sync);
}

/** Re-resolve a resolver preview after the user changes a context. */
export function resolveResolverPreview(
  preview: ImportPreviewState,
  input: ResolverInput,
  sync: TokenSynchronization | undefined,
  siblings: ReadonlyMap<string, string> = new Map(),
): ImportPreviewState {
  const resolver = preview.resolver;
  if (!resolver) return preview;
  const sourceDiagnostics: PreviewDiagnostic[] = [];
  const permutation = resolvePermutation(resolver, input, {
    loadExternal: buildSiblingLoader(siblings, sourceDiagnostics),
  });
  const diagnostics = [
    ...preview.parseDiagnostics,
    ...sourceDiagnostics,
    ...mapDiagnostics(permutation.diagnostics),
    {
      severity: 'warning' as const,
      code: 'resolver.selected-context',
      message: `Import keeps the selected context (${JSON.stringify(input)}) as document tokens. Other contexts and the Resolver project composition are not saved or exported; retain the project files.`,
      sourceFileId: preview.fileName,
    },
  ];
  const unresolved = hasError(diagnostics);
  const next: ImportPreviewState = {
    ...preview,
    resolverInput: input,
    diagnostics,
    added: 0,
    collisions: [],
    document: undefined,
  };
  if (unresolved) return next;
  return attachTokenPreview(
    withBindingDiagnostics({ ...next, document: permutation.document }),
    sync,
  );
}

/** Import retains valid values even when an existing scalar property cannot consume them. */
function withBindingDiagnostics(preview: ImportPreviewState): ImportPreviewState {
  if (!preview.document) return preview;
  const diagnostics = [...preview.diagnostics];
  for (const token of Object.values(preview.document.tokens)) {
    try {
      projectTokenValue(
        token.type ?? '',
        resolveFormatTokenValue(preview.document, token.path.join('.')),
      );
    } catch (error) {
      diagnostics.push({
        severity: 'warning',
        code: 'binding.retained-only',
        message: `${token.path.join('.')}: ${error instanceof Error ? error.message : 'No compatible property mapping.'} The authored token will be retained.`,
      });
    }
  }
  return { ...preview, diagnostics };
}

export interface SourceOption {
  value: string;
  label: string;
}

/** Explicit destination choices for the import preview. */
export function sourceOptions(
  sync: TokenSynchronization | undefined,
  fileName: string,
): SourceOption[] {
  const options: SourceOption[] = [
    { value: NEW_SOURCE_OPTION, label: `New source for ${fileName}` },
  ];
  const sources = Object.values(sync?.store.sources ?? {});
  for (const source of sources) {
    const tracks = source.configuration.entryFiles.includes(fileName);
    const name =
      sources.filter((other) => other.name === source.name).length > 1
        ? `${source.name} (${source.id})`
        : source.name;
    options.push({
      value: source.id,
      label: tracks ? `${name} (tracks ${fileName})` : name,
    });
  }
  return options;
}

/** A filename is a hint, not an identity: ambiguous matches require an explicit choice. */
export function defaultSourceChoice(
  sync: TokenSynchronization | undefined,
  fileName: string,
): string {
  const matches = Object.values(sync?.store.sources ?? {}).filter((source) =>
    source.configuration.entryFiles.includes(fileName),
  );
  return matches.length === 1 ? matches[0]!.id : NEW_SOURCE_OPTION;
}

/**
 * Plan an import against the document the user is looking at. Pure: it
 * returns the next VariableStore plus the exact counts that a successful
 * apply will produce, so the panel can announce a truthful outcome.
 */
export function planDocumentImport(
  document: Document,
  preview: ImportPreviewState,
  sourceChoice: string,
): ImportPlan | null {
  if (!preview.document) return null;
  if (
    importDocumentDiagnostics(docVariableStore(document), preview.document).some(
      (d) => d.severity === 'error',
    )
  )
    return null;
  const store = docVariableStore(document);
  const requested = sourceChoice === NEW_SOURCE_OPTION ? undefined : sourceChoice;
  const resolution = ensureImportSource(store.tokenSync, preview.fileName, requested);
  const incoming = previewImport(resolution.sync.store, preview.document);
  const result = applyImportToSync(
    resolution.sync,
    store,
    incoming,
    resolution.sourceId,
    IMPORT_SPECIFICATION_VERSION,
    IMPORT_ADAPTER_ID,
  );
  return {
    variableStore: {
      ...store,
      tokenSync: result.sync,
      variables: result.variables?.variables ?? store.variables,
      collections: result.variables?.collections ?? store.collections,
    },
    sourceId: resolution.sourceId,
    createdSource: resolution.createdSource,
    createdStore: resolution.createdStore,
    imported: result.imported,
    skipped: result.skipped,
    diagnostics: result.diagnostics,
  };
}

/** Unified preview of what applying the reviewed file would do, whether it is
 * a first import or an update of an already-connected source. */
export interface DocumentSyncPreview {
  /** True when the destination source already owns tokens (three-way update). */
  update: boolean;
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  skipped: number;
  conflicts: SourceUpdateConflict[];
  valid: boolean;
  diagnostics: PreviewDiagnostic[];
}

/** True when `sourceChoice` resolves to a source that already owns tokens. */
function isUpdateDestination(
  sync: TokenSynchronization | undefined,
  sourceChoice: string,
): boolean {
  if (!sync || sourceChoice === NEW_SOURCE_OPTION) return false;
  return tokensBySource(sync.store, sourceChoice as `src_${string}`).length > 0;
}

/**
 * Preview an apply without mutating anything. For a first import this
 * reports new/colliding paths; for a re-import it runs the base/local/remote
 * three-way merge and reports updates, deletions and conflicts.
 */
export function previewDocumentSync(
  document: Document,
  preview: ImportPreviewState,
  sourceChoice: string,
  resolutions: Readonly<Record<string, ConflictResolutionChoice>> = {},
): DocumentSyncPreview | null {
  if (!preview.document) return null;
  const store = docVariableStore(document);
  const sync = store.tokenSync;

  if (!isUpdateDestination(sync, sourceChoice)) {
    const incoming = previewImport(
      sync?.store ?? createEmptyTokenSynchronization().store,
      preview.document,
    );
    const diagnostics = importDocumentDiagnostics(store, preview.document);
    return {
      update: false,
      added: incoming.added,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      skipped: incoming.collisions.length,
      conflicts: [],
      valid: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
      diagnostics,
    };
  }

  const summary = planSourceUpdate(
    sync as TokenSynchronization,
    preview.document,
    sourceChoice as `src_${string}`,
    resolutions,
  );
  return {
    update: true,
    added: summary.added,
    updated: summary.updated,
    deleted: summary.deleted,
    unchanged: summary.unchanged,
    skipped: 0,
    conflicts: summary.conflicts,
    valid: summary.valid,
    diagnostics: mapDiagnostics(summary.plan.diagnostics),
  };
}

/** Validate the complete proposed document, including retained local sources. */
function importDocumentDiagnostics(
  store: VariableStore,
  document: DtcgDocument,
): PreviewDiagnostic[] {
  const retained = Object.values(store.tokenSync?.store.tokens ?? {});
  const paths = new Set(retained.map((token) => token.path.join('.')));
  const incoming = [...snapshotFromDocument(document).values()]
    .filter((token) => !paths.has(token.path.join('.')))
    .map((token) => ({ ...token, type: token.type ?? '', value: token.value }));
  const incomingGroups = previewImport(
    store.tokenSync?.store ?? createEmptyTokenSynchronization().store,
    document,
  ).groups;
  const groups = Object.assign(
    Object.create(null),
    store.tokenSync?.store.groupMeta ?? {},
    incomingGroups,
  );
  const merged = formatDocumentFromTokenRecords([...retained, ...incoming], groups);
  const groupCollisions: TokenDiagnostic[] = Object.entries(incomingGroups)
    .filter(([key, metadata]) => {
      const existing = store.tokenSync?.store.groupMeta?.[key];
      return existing !== undefined && !deepEqual(existing, metadata);
    })
    .map(([key]) => ({
      severity: 'error',
      code: 'import.group-metadata-collision',
      message: `Group metadata at "${key}" is already present with different content. Import is blocked to preserve the existing description, deprecation and extensions; choose distinct group paths or matching metadata.`,
      sourceFileId: document.sourceFileId,
    }));
  return mapDiagnostics([
    ...groupCollisions,
    ...merged.diagnostics,
    ...buildReferenceGraph(merged).diagnostics,
    ...validateResolvedTokenValues(merged),
  ]);
}

/**
 * Commit the reviewed file as one undoable transaction. Returns null when the
 * reviewed file cannot be applied (no document, or unresolved conflicts) so
 * the caller never announces a false success.
 */
export function applyDocumentSync(
  document: Document,
  preview: ImportPreviewState,
  sourceChoice: string,
  resolutions: Readonly<Record<string, ConflictResolutionChoice>> = {},
): {
  variableStore: VariableStore;
  update: boolean;
  applied: number;
  deleted: number;
  createdSource: boolean;
  skipped: number;
} | null {
  if (!preview.document) return null;
  const store = docVariableStore(document);
  const sync = store.tokenSync;

  if (!isUpdateDestination(sync, sourceChoice)) {
    const plan = planDocumentImport(document, preview, sourceChoice);
    if (!plan) return null;
    return {
      variableStore: plan.variableStore,
      update: false,
      applied: plan.imported,
      deleted: 0,
      createdSource: plan.createdSource,
      skipped: plan.skipped,
    };
  }

  const summary = planSourceUpdate(
    sync as TokenSynchronization,
    preview.document,
    sourceChoice as `src_${string}`,
    resolutions,
  );
  if (!summary.valid) return null;
  const result = applyMergePlanToSync(
    sync as TokenSynchronization,
    store,
    summary.plan,
    'default',
    {
      sourceId: sourceChoice as `src_${string}`,
    },
  );
  return {
    variableStore: {
      ...store,
      tokenSync: result.sync,
      variables: result.variables?.variables ?? store.variables,
      collections: result.variables?.collections ?? store.collections,
    },
    update: true,
    applied: result.applied,
    deleted: result.deleted,
    createdSource: false,
    skipped: 0,
  };
}

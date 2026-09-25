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
  createEmptyTokenSynchronization,
  ensureImportSource,
  previewImport,
  type TokenSynchronization,
} from '@varve/scene/tokens';
import {
  type DtcgDocument,
  parseFormatDocument,
  parseResolverDocument,
  type ResolverDocument,
  type ResolverInput,
  resolvePermutation,
  type TokenDiagnostic,
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
    root = JSON.parse(text);
  } catch {
    return 'invalid';
  }
  if (!isPlainObject(root)) return 'invalid';
  const looksLikeResolver =
    Array.isArray(root.resolutionOrder) ||
    (typeof root.version === 'string' &&
      ('sets' in root || 'modifiers' in root || 'sources' in root));
  if (looksLikeResolver) return 'resolver';
  if (fileName.endsWith('.resolver.json')) return 'resolver';
  return 'dtcg';
}

function mapDiagnostics(diagnostics: readonly TokenDiagnostic[]): PreviewDiagnostic[] {
  return diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message }));
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

function buildSiblingLoader(siblings: ReadonlyMap<string, string>) {
  if (siblings.size === 0) return undefined;
  return (ref: string): Record<string, unknown> | undefined => {
    const base = ref.split('/').pop() ?? ref;
    const text = siblings.get(ref) ?? siblings.get(base);
    if (text === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      return isPlainObject(parsed) ? parsed : undefined;
    } catch {
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
    const diagnostics: PreviewDiagnostic[] = [
      {
        severity: 'error',
        code: 'json.syntax',
        message: `${identity.name} is not a JSON object and cannot be imported.`,
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
    const parseDiagnostics = mapDiagnostics(resolver.diagnostics);
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
  const diagnostics = mapDiagnostics(document.diagnostics);
  const preview: ImportPreviewState = {
    kind,
    ...base,
    parseDiagnostics: diagnostics,
    diagnostics,
    added: 0,
    collisions: [],
    document: hasError(diagnostics) ? undefined : document,
  };
  return attachTokenPreview(preview, sync);
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
  const permutation = resolvePermutation(resolver, input, {
    loadExternal: buildSiblingLoader(siblings),
  });
  const diagnostics = [...preview.parseDiagnostics, ...mapDiagnostics(permutation.diagnostics)];
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
  return attachTokenPreview({ ...next, document: permutation.document }, sync);
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
  for (const source of Object.values(sync?.store.sources ?? {})) {
    const tracks = source.configuration.entryFiles.includes(fileName);
    options.push({
      value: source.id,
      label: tracks ? `${source.name} (tracks ${fileName})` : source.name,
    });
  }
  return options;
}

/** Default destination: an existing source that already tracks this file. */
export function defaultSourceChoice(
  sync: TokenSynchronization | undefined,
  fileName: string,
): string {
  const match = Object.values(sync?.store.sources ?? {}).find((source) =>
    source.configuration.entryFiles.includes(fileName),
  );
  return match?.id ?? NEW_SOURCE_OPTION;
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

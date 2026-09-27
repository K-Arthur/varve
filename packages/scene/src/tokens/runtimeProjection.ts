/** Source values stay authored; Variables expose projections to existing property consumers. */
import {
  buildReferenceGraph,
  type DtcgDocument,
  parseFormatDocument,
  resolveFormatTokenValue,
  type TokenDiagnostic,
  validateResolvedTokenValues,
} from '@varve/tokens';
import type { VariableStore, VariableValue } from '../variableTypes';
import { type DtcgColor, dtcgColorToManagedColor } from './colorBridge';
import type { DesignTokenRecord, TokenGroupMeta } from './model';
import { updateToken } from './store';

const documents = new WeakMap<VariableStore, DtcgDocument>();
const projections = new WeakMap<VariableStore, Map<string, VariableValue>>();
const referenceGraphs = new WeakMap<VariableStore, ReturnType<typeof buildReferenceGraph>>();

export function activeVariableMode(store: VariableStore, variableId: string): string {
  for (const collection of Object.values(store.collections)) {
    // Preserve the existing first-collection precedence even for a malformed
    // native document that lists a Variable more than once. Read this each
    // time because callers may update activeMode in place.
    if (collection.variableIds.includes(variableId)) {
      return collection.activeMode;
    }
  }
  return store.activeMode;
}

function activeValue(store: VariableStore, variableId: string): unknown {
  const variable = store.variables[variableId];
  if (!variable) return undefined;
  const mode = activeVariableMode(store, variableId);
  return (
    variable.valuesByMode[mode] ??
    variable.valuesByMode.default ??
    variable.valuesByMode[store.modes[0] ?? 'default']
  );
}

/** Transient Format document: the standards engine owns reference semantics. Cached per immutable store. */
export function formatDocumentFromTokenRecords(
  records: readonly (Pick<DesignTokenRecord, 'path' | 'type' | 'value'> &
    Partial<Pick<DesignTokenRecord, 'description' | 'deprecated' | 'extensions'>>)[],
  groups: Readonly<Record<string, TokenGroupMeta>> = {},
): DtcgDocument {
  const root: Record<string, unknown> = Object.create(null);
  const diagnostics: TokenDiagnostic[] = [];
  const paths = new Set<string>();
  const groupPaths = new Set(Object.keys(groups));
  const tokenBlockedByDescendantGroup = new Set<string>();
  for (const groupPath of groupPaths) {
    const segments = groupPath.split('.');
    for (let length = 1; length < segments.length; length += 1) {
      tokenBlockedByDescendantGroup.add(segments.slice(0, length).join('.'));
    }
  }
  for (const [path, group] of Object.entries(groups)) {
    let parent = root;
    for (const segment of path ? path.split('.') : []) {
      parent[segment] ??= Object.create(null);
      parent = parent[segment] as Record<string, unknown>;
    }
    if (group.description !== undefined) parent.$description = group.description;
    if (group.deprecated !== undefined) parent.$deprecated = group.deprecated;
    if (group.extensions !== undefined) parent.$extensions = group.extensions;
  }
  for (const token of records) {
    const path = token.path.join('.');
    if (paths.has(path) || groupPaths.has(path) || tokenBlockedByDescendantGroup.has(path)) {
      diagnostics.push({
        severity: 'error',
        code: 'document.token-path-collision',
        message: `${path} conflicts with another token or stored group metadata. Choose a distinct path before applying.`,
        sourceFileId: 'document-tokens',
      });
      continue;
    }
    paths.add(path);
    let parent = root;
    for (const segment of token.path.slice(0, -1)) {
      parent[segment] ??= Object.create(null);
      parent = parent[segment] as Record<string, unknown>;
    }
    const value = token.value;
    const reference =
      value &&
      typeof value === 'object' &&
      Object.hasOwn(value, '$ref') &&
      Object.keys(value).length === 1;
    parent[token.path.at(-1) ?? '$root'] = {
      $type: token.type,
      ...(reference ? value : { $value: value }),
      ...(token.description !== undefined ? { $description: token.description } : {}),
      ...(token.deprecated !== undefined ? { $deprecated: token.deprecated } : {}),
      ...(token.extensions !== undefined ? { $extensions: token.extensions } : {}),
    };
  }
  const document = parseFormatDocument(JSON.stringify(root), { sourceFileId: 'document-tokens' });
  document.diagnostics.push(...diagnostics);
  // A token cannot also be an ancestor group. Rebuilding a mixed-source
  // tree can otherwise hide one record behind another token's $value.
  for (const token of records) {
    const key = token.path.join('.');
    if (Object.hasOwn(document.tokens, key)) continue;
    document.diagnostics.push({
      severity: 'error',
      code: 'document.token-path-collision',
      message: `${key} cannot be represented alongside another token at an ancestor path. Move it to a distinct group before applying.`,
      sourceFileId: document.sourceFileId,
    });
  }
  return document;
}

function resolutionDocument(store: VariableStore): DtcgDocument {
  const cached = documents.get(store);
  if (cached) return cached;
  const tokens = store.tokenSync?.store;
  const linked = new Map(
    Object.entries(tokens?.variableLinks ?? {}).map(([variable, token]) => [token, variable]),
  );
  const records = Object.values(tokens?.tokens ?? {}).map((token) => {
    const variable = linked.get(token.id);
    const value = variable ? (activeValue(store, variable) ?? token.value) : token.value;
    return { ...token, value };
  });
  const document = formatDocumentFromTokenRecords(records, tokens?.groupMeta);
  documents.set(store, document);
  return document;
}

export function resolveTokenVariableValue(store: VariableStore, variableId: string): VariableValue {
  const cached = projections.get(store)?.get(variableId);
  if (cached !== undefined) return cached;
  const tokenId = store.tokenSync?.store.variableLinks[variableId];
  const token = tokenId ? store.tokenSync?.store.tokens[tokenId] : undefined;
  if (!token) throw new Error(`Missing synchronized token for variable ${variableId}`);
  const value = resolveAuthoredTokenValue(store, variableId);
  const projected = projectTokenValue(token.type, value);
  const values = projections.get(store) ?? new Map<string, VariableValue>();
  values.set(variableId, projected);
  projections.set(store, values);
  return projected;
}

/** Resolved standards value, before contextual conversion into a node property. */
export function resolveAuthoredTokenValue(store: VariableStore, variableId: string): unknown {
  const token = tokenForVariableId(store, variableId);
  if (!token) throw new Error(`Missing synchronized token for variable ${variableId}`);
  return resolveFormatTokenValue(resolutionDocument(store), token.path.join('.'));
}

/** Property compatibility differs from standards validity. Unmapped values remain retained. */
export function projectTokenValue(type: string, value: unknown): VariableValue {
  if (type === 'color') {
    // Legacy/native hexadecimal input is already diagnosed by the strict
    // parser. Retain its authored form and use the existing native binding.
    if (typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) return value;
    return dtcgColorToManagedColor(value as DtcgColor) as unknown as VariableValue;
  }
  if (type === 'dimension') {
    const dimension = value as { value: number; unit: string };
    if (dimension.unit !== 'px')
      throw new Error('A rem dimension needs an explicit document root-font size before binding.');
    return dimension.value;
  }
  if ((type === 'number' || type === 'fontWeight') && typeof value === 'number') return value;
  if ((type === 'fontFamily' || type === 'string') && typeof value === 'string') return value;
  if (type === 'boolean' && typeof value === 'boolean') return value;
  throw new Error(`The ${type} token is retained, but has no compatible scalar property binding.`);
}

/** Reverse editing updates the token and source status in the same immutable transaction. */
export function synchronizeVariableEdit(
  store: VariableStore,
  variableId: string,
  previousStore?: VariableStore,
): VariableStore {
  const sync = store.tokenSync;
  const id = sync?.store.variableLinks[variableId];
  const token = id ? sync?.store.tokens[id] : undefined;
  if (!sync || !id || !token) return store;
  const value = activeValue(store, variableId);
  if (JSON.stringify(value) === JSON.stringify(token.value)) return store;
  const document = resolutionDocument(store);
  const diagnostics = [
    ...document.diagnostics,
    ...buildReferenceGraph(document).diagnostics,
    ...validateResolvedTokenValues(document),
  ];
  const invalid = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (invalid) throw new Error(`${invalid.code}: ${invalid.message}`);
  if (previousStore) {
    const unavailable = runtimeProjectionChangeDiagnostics(previousStore, store);
    if (unavailable.length > 0)
      throw new Error(`${unavailable[0]!.code}: ${unavailable[0]!.message}`);
  }
  const result = updateToken(sync.store, id, {
    value,
    localState: { ...token.localState, locallyModified: true },
  });
  if (result.diagnostics.length > 0) throw new Error(result.diagnostics[0]?.message);
  const sourceId = token.source?.sourceId;
  const source = sourceId ? result.store.sources[sourceId] : undefined;
  const next =
    source && sourceId
      ? {
          ...result.store,
          sources: {
            ...result.store.sources,
            [sourceId]: {
              ...source,
              syncState: { ...source.syncState, status: 'local-changes' as const },
            },
          },
        }
      : result.store;
  return { ...store, tokenSync: { ...sync, store: next } };
}

/** Preserve working linked values when an edit changes a foundation or its dependents. */
export function runtimeProjectionChangeDiagnostics(
  previous: VariableStore,
  next: VariableStore,
): TokenDiagnostic[] {
  const diagnostics: TokenDiagnostic[] = [];
  for (const id of Object.keys(previous.tokenSync?.store.variableLinks ?? {})) {
    if (!next.tokenSync?.store.variableLinks[id]) continue;
    try {
      resolveTokenVariableValue(previous, id);
    } catch {
      continue;
    }
    try {
      resolveTokenVariableValue(next, id);
    } catch (error) {
      const token = tokenForVariableId(previous, id);
      diagnostics.push({
        severity: 'error',
        code: 'token.runtime-projection-change-unsupported',
        sourceFileId: 'document-tokens',
        message: `${token?.path.join('.') ?? id} currently supplies a working linked value. This edit would make it unavailable: ${error instanceof Error ? error.message : String(error)} Retain the compatible value or detach its consumers first.`,
      });
    }
  }
  return diagnostics;
}

export function tokenForVariableId(
  store: VariableStore,
  id: string,
): DesignTokenRecord | undefined {
  const tokenId = store.tokenSync?.store.variableLinks[id];
  return tokenId ? store.tokenSync?.store.tokens[tokenId] : undefined;
}

/** Expand the renderer's existing dependency map with both standard reference forms. */
export function extendTokenBindingDependencies(
  dependencies: Map<string, Set<string>>,
  store: VariableStore,
): void {
  const sync = store.tokenSync?.store;
  if (!sync) return;
  let graph = referenceGraphs.get(store);
  if (!graph) {
    graph = buildReferenceGraph(resolutionDocument(store));
    referenceGraphs.set(store, graph);
  }
  const variablesByPath = new Map<string, string[]>();
  for (const [variableId, tokenId] of Object.entries(sync.variableLinks)) {
    const token = sync.tokens[tokenId];
    if (!token) continue;
    const key = token.path.join('.');
    variablesByPath.set(key, [...(variablesByPath.get(key) ?? []), variableId]);
  }
  for (const [variableId, nodes] of [...dependencies]) {
    const token = tokenForVariableId(store, variableId);
    if (!token) continue;
    const pending = [token.path.join('.')];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const key = pending.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const edge of graph.outgoing.get(key) ?? []) {
        if (!edge.to) continue;
        for (const targetId of variablesByPath.get(edge.to) ?? []) {
          const affected = dependencies.get(targetId) ?? new Set<string>();
          for (const nodeId of nodes) affected.add(nodeId);
          dependencies.set(targetId, affected);
        }
        pending.push(edge.to);
      }
    }
  }
}

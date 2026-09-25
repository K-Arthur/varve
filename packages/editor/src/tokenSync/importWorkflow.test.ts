/**
 * Import workflow tests: format routing, first-use initialization,
 * resolver previews, source selection, and import planning.
 */
import { createDocument, type Document } from '@varve/scene';
import {
  addSource,
  addToken,
  captureBaseSnapshot,
  createEmptyTokenSynchronization,
  setBaseSnapshot,
} from '@varve/scene/tokens';
import { describe, expect, it } from 'vitest';
import {
  applyDocumentSync,
  buildImportPreview,
  defaultSourceChoice,
  detectDocumentKind,
  hashText,
  NEW_SOURCE_OPTION,
  planDocumentImport,
  previewDocumentSync,
  resolveResolverPreview,
  sourceOptions,
} from './importWorkflow';

const SPACING = '{"spacing": {"$type": "dimension", "$value": {"value": 8, "unit": "px"}}}';

function identity(name: string) {
  return { name, size: name.length, lastModified: 1_700_000_000_000 };
}

function seededDocument(): Document {
  const sync = createEmptyTokenSynchronization();
  sync.store = addSource(sync.store, {
    id: 'src_one',
    name: 'Brand tokens',
    kind: 'local-file',
    direction: 'import-only',
    adapterId: 'dtcg-2025.10',
    configuration: {
      entryFiles: ['brand.tokens.json'],
      direction: 'import-only',
      stableIdPolicy: 'annotate',
    },
    syncState: { status: 'clean' },
  });
  const doc = createDocument('Import Workflow') as Document & {
    variableStore: Record<string, unknown>;
  };
  (doc as unknown as Record<string, unknown>).variableStore = {
    variables: {},
    collections: {},
    activeCollectionId: '',
    modes: ['default'],
    activeMode: 'default',
    tokenSync: sync,
  };
  return doc;
}

function syncOf(doc: Document) {
  return (
    doc as unknown as {
      variableStore: { tokenSync: ReturnType<typeof createEmptyTokenSynchronization> };
    }
  ).variableStore.tokenSync;
}

function storeOf(doc: Document) {
  return (doc as unknown as { variableStore: Record<string, unknown> }).variableStore;
}

describe('format detection', () => {
  it('routes by content before the file extension', () => {
    expect(detectDocumentKind(SPACING, 'anything.json')).toBe('dtcg');
    expect(detectDocumentKind('{"version": "2025.10", "sets": {}, "resolutionOrder": []}')).toBe(
      'resolver',
    );
    expect(detectDocumentKind('{"resolutionOrder": []}')).toBe('resolver');
    expect(detectDocumentKind('{broken')).toBe('invalid');
    expect(detectDocumentKind('[]')).toBe('invalid');
  });

  it('uses the .resolver.json extension only as a tie-breaker', () => {
    expect(detectDocumentKind('{"groups": {}}', 'core.resolver.json')).toBe('resolver');
    expect(detectDocumentKind('{"groups": {}}', 'core.tokens.json')).toBe('dtcg');
  });
});

describe('first import into a fresh document', () => {
  it('reports importable tokens when the document has no token store at all', () => {
    const preview = buildImportPreview(SPACING, identity('tokens.json'), undefined);
    expect(preview.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(preview.added).toBe(1);
    expect(preview.document).toBeDefined();
  });

  it('creates the token store and a source when the import is planned', () => {
    const doc = createDocument('Fresh');
    const preview = buildImportPreview(SPACING, identity('tokens.json'), undefined);
    const plan = planDocumentImport(doc, preview, NEW_SOURCE_OPTION);
    expect(plan).not.toBeNull();
    expect(plan?.createdStore).toBe(true);
    expect(plan?.createdSource).toBe(true);
    expect(plan?.imported).toBe(1);

    const next = plan?.variableStore as {
      tokenSync: ReturnType<typeof createEmptyTokenSynchronization>;
      variables: Record<string, unknown>;
    };
    expect(next.tokenSync).toBeDefined();
    expect(Object.keys(next.tokenSync.store.sources)).toHaveLength(1);
    expect(Object.keys(next.tokenSync.store.tokens)).toHaveLength(1);
    expect(Object.keys(next.variables)).toHaveLength(1);
    // The source document is untouched until updateDoc commits the plan.
    expect((doc as unknown as { variableStore?: unknown }).variableStore).toBeUndefined();
  });
});

describe('preview identity and freshness', () => {
  it('gives same-named files from different places distinct revisions', () => {
    const a = buildImportPreview(SPACING, identity('tokens.json'), undefined);
    const b = buildImportPreview(
      '{"spacing": {"$type": "dimension", "$value": {"value": 4, "unit": "px"}}}',
      identity('tokens.json'),
      undefined,
    );
    expect(a.fileName).toBe(b.fileName);
    expect(a.textHash).not.toBe(b.textHash);
    expect(hashText(SPACING)).toBe(hashText(SPACING));
  });

  it('pins the reviewed document object for the apply step', () => {
    const preview = buildImportPreview(SPACING, identity('tokens.json'), undefined);
    const plan = planDocumentImport(createDocument('Fresh'), preview, NEW_SOURCE_OPTION);
    expect(plan?.imported).toBe(1);
    // Re-running the same preview against a fresh document is deterministic.
    const again = planDocumentImport(createDocument('Fresh'), preview, NEW_SOURCE_OPTION);
    expect(again?.imported).toBe(1);
  });
});

describe('collisions and no-op imports', () => {
  it('reports collisions and plans nothing new', () => {
    const doc = seededDocument();
    const sync = syncOf(doc);
    sync.store = addToken(sync.store, {
      id: 'tok_existing',
      path: ['spacing'],
      displayName: 'spacing',
      type: 'dimension',
      value: { value: 4, unit: 'px' },
      extensions: {},
      localState: {
        createdLocally: false,
        detachedFromSource: false,
        locallyModified: false,
        unresolved: false,
        conflicted: false,
      },
    } as never).store;
    const preview = buildImportPreview(SPACING, identity('brand.tokens.json'), sync);
    expect(preview.collisions).toEqual(['spacing']);
    expect(preview.added).toBe(0);
    const plan = planDocumentImport(doc, preview, 'src_one');
    expect(plan?.imported).toBe(0);
    expect(plan?.skipped).toBe(1);
  });

  it('does not mutate the document variable store while planning', () => {
    const doc = seededDocument();
    const store = storeOf(doc);
    const before = Object.keys(store.variables as Record<string, unknown>).length;
    const preview = buildImportPreview(SPACING, identity('brand.tokens.json'), syncOf(doc));
    planDocumentImport(doc, preview, 'src_one');
    expect(Object.keys(store.variables as Record<string, unknown>)).toHaveLength(before);
  });
});

describe('source selection', () => {
  it('defaults to an existing source that already tracks the file', () => {
    const doc = seededDocument();
    expect(defaultSourceChoice(syncOf(doc), 'brand.tokens.json')).toBe('src_one');
    expect(defaultSourceChoice(syncOf(doc), 'other.json')).toBe(NEW_SOURCE_OPTION);
    expect(defaultSourceChoice(undefined, 'tokens.json')).toBe(NEW_SOURCE_OPTION);
  });

  it('offers every source plus the new-source option', () => {
    const options = sourceOptions(syncOf(seededDocument()), 'other.json');
    expect(options.map((o) => o.value)).toEqual([NEW_SOURCE_OPTION, 'src_one']);
    expect(options[0]?.label).toContain('other.json');
  });

  it('plans into the explicitly chosen source', () => {
    const doc = seededDocument();
    const preview = buildImportPreview(SPACING, identity('brand.tokens.json'), syncOf(doc));
    const plan = planDocumentImport(doc, preview, 'src_one');
    expect(plan?.createdSource).toBe(false);
    expect(plan?.sourceId).toBe('src_one');
    expect(Object.keys(plan?.variableStore.tokenSync?.store.tokens ?? {})).toHaveLength(1);
  });
});

describe('resolver documents', () => {
  const RESOLVER = JSON.stringify({
    version: '2025.10',
    sets: {
      core: {
        sources: [
          {
            color: {
              bg: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1] } },
            },
          },
        ],
      },
    },
    modifiers: {
      theme: {
        contexts: {
          light: [],
          dark: [
            {
              color: {
                bg: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 1] } },
              },
            },
          ],
        },
        default: 'light',
      },
    },
    resolutionOrder: [{ $ref: '#/sets/core' }, { $ref: '#/modifiers/theme' }],
  });

  it('routes a resolver file to the resolver parser instead of the format parser', () => {
    const preview = buildImportPreview(RESOLVER, identity('theme.resolver.json'), undefined);
    expect(preview.kind).toBe('resolver');
    expect(preview.resolver).toBeDefined();
    expect(preview.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(preview.added).toBe(1);
  });

  it('exposes one selectable context per modifier and re-resolves on change', () => {
    const preview = buildImportPreview(RESOLVER, identity('theme.resolver.json'), undefined);
    expect(Object.keys(preview.resolverInput ?? {})).toEqual(['theme']);
    expect(preview.resolverInput?.theme).toBe('light');
    const dark = resolveResolverPreview(preview, { theme: 'dark' }, undefined);
    expect(dark.resolverInput?.theme).toBe('dark');
    expect(dark.document).toBeDefined();
    expect(dark.added).toBeGreaterThan(0);
    // Diagnostics must not accumulate across re-resolutions.
    expect(dark.diagnostics.length).toBe(preview.diagnostics.length);
  });

  it('reports an invalid context as an error instead of resolving it', () => {
    const preview = buildImportPreview(RESOLVER, identity('theme.resolver.json'), undefined);
    const bad = resolveResolverPreview(preview, { theme: 'neon' }, undefined);
    expect(bad.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(bad.document).toBeUndefined();
    expect(bad.added).toBe(0);
  });

  it('reports unresolvable external references instead of silently dropping them', () => {
    const external = JSON.stringify({
      version: '2025.10',
      sets: { core: { sources: [{ $ref: './missing.json' }] } },
      resolutionOrder: [{ $ref: '#/sets/core' }],
    });
    const preview = buildImportPreview(external, identity('theme.resolver.json'), undefined);
    expect(preview.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(preview.document).toBeUndefined();
  });

  it('loads sibling files picked alongside the resolver', () => {
    const resolver = JSON.stringify({
      version: '2025.10',
      sets: { core: { sources: [{ $ref: 'foundation.json' }] } },
      resolutionOrder: [{ $ref: '#/sets/core' }],
    });
    const foundation = JSON.stringify({
      color: { bg: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } } },
    });
    const preview = buildImportPreview(
      resolver,
      identity('theme.resolver.json'),
      undefined,
      new Map([['foundation.json', foundation]]),
    );
    expect(preview.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(preview.added).toBe(1);
    expect(preview.siblingCount).toBe(1);
  });
});

describe('invalid input', () => {
  it('keeps unreadable material out of the committed path', () => {
    const preview = buildImportPreview('{broken', identity('bad.json'), undefined);
    expect(preview.kind).toBe('invalid');
    expect(preview.document).toBeUndefined();
    expect(preview.added).toBe(0);
    const plan = planDocumentImport(createDocument('Fresh'), preview, NEW_SOURCE_OPTION);
    expect(plan).toBeNull();
  });
});

function syncedDocument(localValue: number, baseValue: number): Document {
  const sync = createEmptyTokenSynchronization();
  sync.store = addSource(sync.store, {
    id: 'src_one',
    name: 'Brand tokens',
    kind: 'local-file',
    direction: 'bidirectional',
    adapterId: 'dtcg-2025.10',
    configuration: {
      entryFiles: ['brand.tokens.json'],
      direction: 'bidirectional',
      stableIdPolicy: 'annotate',
    },
    syncState: { status: 'clean' },
  });
  sync.store = addToken(sync.store, {
    id: 'tok_a',
    path: ['a'],
    displayName: 'a',
    type: 'number',
    value: localValue,
    extensions: {},
    source: {
      sourceId: 'src_one',
      sourceFileId: 'brand.tokens.json',
      sourcePointer: '/a',
      adapterId: 'dtcg-2025.10',
      specificationVersion: '2025.10',
      lastImportedValue: baseValue,
    },
    localState: {
      createdLocally: false,
      detachedFromSource: false,
      locallyModified: localValue !== baseValue,
      unresolved: false,
      conflicted: false,
    },
  } as never).store;
  const baseSource = {
    ...sync.store,
    tokens: { ...sync.store.tokens, tok_a: { ...sync.store.tokens.tok_a, value: baseValue } },
  } as typeof sync.store;
  sync.store = setBaseSnapshot(sync.store, captureBaseSnapshot(baseSource, 'src_one', 'T0'));

  const doc = createDocument('Synced') as Document & { variableStore: Record<string, unknown> };
  (doc as unknown as Record<string, unknown>).variableStore = {
    variables: {},
    collections: {},
    activeCollectionId: '',
    modes: ['default'],
    activeMode: 'default',
    tokenSync: sync,
  };
  return doc;
}

describe('external updates (three-way merge)', () => {
  it('reports a remote value change as an update, not a new import', () => {
    const doc = syncedDocument(1, 1);
    const preview = buildImportPreview(
      '{"a": {"$type": "number", "$value": 2}}',
      identity('brand.tokens.json'),
      syncOf(doc),
    );
    const summary = previewDocumentSync(doc, preview, 'src_one');
    expect(summary?.update).toBe(true);
    expect(summary?.updated).toBe(1);
    expect(summary?.added).toBe(0);
    expect(summary?.conflicts).toHaveLength(0);
  });

  it('applies an updated value as one transaction', () => {
    const doc = syncedDocument(1, 1);
    const preview = buildImportPreview(
      '{"a": {"$type": "number", "$value": 2}}',
      identity('brand.tokens.json'),
      syncOf(doc),
    );
    const applied = applyDocumentSync(doc, preview, 'src_one');
    expect(applied?.update).toBe(true);
    expect(applied?.applied).toBe(1);
    const token = Object.values(applied?.variableStore.tokenSync?.store.tokens ?? {})[0];
    expect(token?.value).toBe(2);
    // The source document is untouched until updateDoc commits the plan.
    expect(syncOf(doc).store.tokens.tok_a?.value).toBe(1);
  });

  it('blocks apply on a concurrent edit until a resolution is chosen', () => {
    const doc = syncedDocument(2, 1);
    const preview = buildImportPreview(
      '{"a": {"$type": "number", "$value": 3}}',
      identity('brand.tokens.json'),
      syncOf(doc),
    );
    const blocked = previewDocumentSync(doc, preview, 'src_one');
    expect(blocked?.valid).toBe(false);
    expect(blocked?.conflicts).toHaveLength(1);
    expect(applyDocumentSync(doc, preview, 'src_one')).toBeNull();

    const resolved = previewDocumentSync(doc, preview, 'src_one', { a: 'remote' });
    expect(resolved?.valid).toBe(true);
    const applied = applyDocumentSync(doc, preview, 'src_one', { a: 'remote' });
    const token = Object.values(applied?.variableStore.tokenSync?.store.tokens ?? {})[0];
    expect(token?.value).toBe(3);

    const kept = applyDocumentSync(doc, preview, 'src_one', { a: 'local' });
    const keptToken = Object.values(kept?.variableStore.tokenSync?.store.tokens ?? {})[0];
    expect(keptToken?.value).toBe(2);
  });

  it('removes a token the source deleted', () => {
    const doc = syncedDocument(1, 1);
    const preview = buildImportPreview('{}', identity('brand.tokens.json'), syncOf(doc));
    const summary = previewDocumentSync(doc, preview, 'src_one');
    expect(summary?.deleted).toBe(1);
    const applied = applyDocumentSync(doc, preview, 'src_one');
    expect(applied?.deleted).toBe(1);
    expect(Object.keys(applied?.variableStore.tokenSync?.store.tokens ?? {})).toHaveLength(0);
    // The deletion is tombstoned, not forgotten.
    expect(Object.keys(applied?.variableStore.tokenSync?.store.tombstones ?? {})).toHaveLength(1);
  });
});

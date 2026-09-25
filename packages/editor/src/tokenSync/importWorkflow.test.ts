/**
 * Import workflow tests: format routing, first-use initialization,
 * resolver previews, source selection, and import planning.
 */
import { createDocument, type Document } from '@varve/scene';
import { addSource, addToken, createEmptyTokenSynchronization } from '@varve/scene/tokens';
import { describe, expect, it } from 'vitest';
import {
  buildImportPreview,
  defaultSourceChoice,
  detectDocumentKind,
  hashText,
  NEW_SOURCE_OPTION,
  planDocumentImport,
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

/**
 * TokenSyncPanel tests (jsdom): empty state, source status rendering,
 * change summary, and the full import flow through the real file input —
 * pick → preview → apply → announce. useEditor is mocked with a controlled
 * harness (the full EditorProvider is out of scope here and is covered by
 * editor-level integration specs).
 */
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Document } from '@varve/scene';
import { createDocument } from '@varve/scene';
import {
  addSource,
  addToken,
  captureBaseSnapshot,
  createEmptyTokenSynchronization,
  setBaseSnapshot,
} from '@varve/scene/tokens';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenSyncPanel } from './TokenSyncPanel';

const editorMock = vi.hoisted(() => ({
  state: { document: null as Document | null },
  updateDoc: (fn: (doc: Document) => Document) => {
    if (editorMock.state.document) editorMock.state.document = fn(editorMock.state.document);
  },
  beginTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  announce: vi.fn(),
}));

vi.mock('../../context', () => ({
  useEditor: () => editorMock,
}));

function seedDoc(
  seed: (sync: ReturnType<typeof createEmptyTokenSynchronization>) => void,
): Document {
  const sync = createEmptyTokenSynchronization();
  seed(sync);
  const doc = createDocument('Token Sync Test') as Document & {
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

function addCleanSource(sync: ReturnType<typeof createEmptyTokenSynchronization>, id = 'src_one') {
  sync.store = addSource(sync.store, {
    id: id as `src_${string}`,
    name: 'Brand tokens',
    kind: 'local-file',
    direction: 'import-only',
    adapterId: 'dtcg-2025.10',
    configuration: {
      entryFiles: ['tokens.json'],
      direction: 'import-only',
      stableIdPolicy: 'annotate',
    },
    syncState: { status: 'clean' },
  });
  return sync;
}

async function pickFile(name: string, text: string) {
  const input = screen.getByLabelText('Import DTCG token file') as HTMLInputElement;
  const file = new File([text], name, {
    type: 'application/json',
    lastModified: 1_700_000_000_000,
  });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  await screen.findByText(/revision/i);
}

beforeEach(() => {
  editorMock.state.document = null;
  editorMock.announce.mockClear();
  editorMock.beginTransaction.mockClear();
  editorMock.commitTransaction.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('TokenSyncPanel', () => {
  it('renders an empty state that promises a source will be created', () => {
    editorMock.state.document = createDocument('Empty');
    render(<TokenSyncPanel />);
    expect(screen.getByText('Token Sync')).toBeTruthy();
    expect(screen.getByText(/No token sources yet/)).toBeTruthy();
    expect(screen.getByText(/a source is created for you/i)).toBeTruthy();
  });

  it('renders source status rows and change summary', () => {
    editorMock.state.document = seedDoc((sync) => {
      addCleanSource(sync);
      sync.store = addToken(sync.store, {
        id: 'tok_a',
        path: ['color', 'brand', 'primary'],
        displayName: 'primary',
        type: 'color',
        value: '#0066cc',
        extensions: {},
        source: {
          sourceId: 'src_one',
          sourceFileId: 'tokens.json',
          sourcePointer: '/color/brand/primary',
          adapterId: 'dtcg-2025.10',
          specificationVersion: '2025.10',
        },
        localState: {
          createdLocally: false,
          detachedFromSource: false,
          locallyModified: true,
          unresolved: false,
          conflicted: false,
        },
      } as never).store;
    });
    render(<TokenSyncPanel />);
    // Scoped to the row: the selected-source detail repeats the same name
    // and status, so an unscoped text query is no longer unique.
    expect(
      screen.getByText('Brand tokens', { selector: '.token-sync-panel__source-name' }),
    ).toBeTruthy();
    expect(
      screen.getByText('In sync', {
        selector: '.token-sync-panel__source-meta .token-sync-status',
      }),
    ).toBeTruthy();
    expect(screen.getByText(/1 tokens, 1 modified/)).toBeTruthy();
    expect(screen.getByText(/1 local changes/)).toBeTruthy();
  });

  it('shows conflict counts when tokens are conflicted', () => {
    editorMock.state.document = seedDoc((sync) => {
      addCleanSource(sync);
      const source = sync.store.sources.src_one;
      if (source) source.syncState = { status: 'conflicted' };
      sync.store = addToken(sync.store, {
        id: 'tok_a',
        path: ['a'],
        displayName: 'a',
        type: 'number',
        value: 1,
        extensions: {},
        source: {
          sourceId: 'src_one',
          sourceFileId: 'tokens.json',
          sourcePointer: '/a',
          adapterId: 'dtcg-2025.10',
          specificationVersion: '2025.10',
        },
        localState: {
          createdLocally: false,
          detachedFromSource: false,
          locallyModified: false,
          unresolved: false,
          conflicted: true,
        },
      } as never).store;
    });
    render(<TokenSyncPanel />);
    expect(
      screen.getByText('Conflicts', {
        selector: '.token-sync-panel__source-meta .token-sync-status',
      }),
    ).toBeTruthy();
    expect(screen.getByText(/1 conflicts/)).toBeTruthy();
  });
});

describe('TokenSyncPanel import flow', () => {
  it('imports into a fresh document that has no token store at all', async () => {
    editorMock.state.document = createDocument('Fresh');
    render(<TokenSyncPanel />);
    await pickFile(
      'tokens.json',
      '{"spacing": {"$type": "dimension", "$value": {"value": 8, "unit": "px"}}}',
    );
    expect(screen.getByText(/1 tokens ready to import/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /apply import/i }));

    expect(editorMock.beginTransaction).toHaveBeenCalled();
    expect(editorMock.commitTransaction).toHaveBeenCalled();
    expect(editorMock.announce).toHaveBeenCalledWith(
      expect.stringContaining('Imported 1 tokens from tokens.json into a new source'),
    );

    const doc = editorMock.state.document as unknown as {
      variableStore: { tokenSync: { store: { sources: Record<string, unknown> } } };
    };
    expect(Object.keys(doc.variableStore.tokenSync.store.sources)).toHaveLength(1);
    // The preview is consumed and the panel returns to its resting state.
    expect(screen.queryByText(/ready to import/)).toBeNull();
  });

  it('previews parse errors without applying anything', async () => {
    editorMock.state.document = createDocument('Fresh');
    render(<TokenSyncPanel />);
    await pickFile('bad.json', '{broken');
    expect(screen.getByText(/error\(s\) above to continue/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /apply import/i }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(editorMock.announce).not.toHaveBeenCalled();
  });

  it('reports a no-op instead of announcing success', async () => {
    editorMock.state.document = seedDoc((sync) => {
      addCleanSource(sync);
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
    });
    render(<TokenSyncPanel />);
    await pickFile(
      'tokens.json',
      '{"spacing": {"$type": "dimension", "$value": {"value": 8, "unit": "px"}}}',
    );
    expect(screen.getByText(/existing token path\(s\) would be skipped/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /apply import/i }).getAttribute('aria-disabled'),
    ).toBe('true');

    // The user is told exactly why nothing can be applied; no false success.
    expect(editorMock.announce).not.toHaveBeenCalled();
  });

  it('releases the preview on cancel', async () => {
    editorMock.state.document = createDocument('Fresh');
    render(<TokenSyncPanel />);
    await pickFile(
      'tokens.json',
      '{"spacing": {"$type": "dimension", "$value": {"value": 8, "unit": "px"}}}',
    );
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText(/ready to import/)).toBeNull();
    expect(screen.queryByText(/revision/i)).toBeNull();
  });

  it('exports the document token store as a DTCG file', async () => {
    const createObjectURL = vi.fn(() => 'blob:token-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    editorMock.state.document = seedDoc((sync) => {
      addCleanSource(sync);
      sync.store = addToken(sync.store, {
        id: 'tok_spacing',
        path: ['spacing'],
        displayName: 'spacing',
        type: 'dimension',
        value: { value: 8, unit: 'px' },
        extensions: {},
        localState: {
          createdLocally: false,
          detachedFromSource: false,
          locallyModified: false,
          unresolved: false,
          conflicted: false,
        },
      } as never).store;
    });
    render(<TokenSyncPanel />);
    fireEvent.click(screen.getByRole('button', { name: /export dtcg file/i }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(editorMock.announce).toHaveBeenCalledWith(
      expect.stringContaining('Exported 1 token(s)'),
    );
    vi.unstubAllGlobals();
  });

  it('disables export when the document has no tokens', () => {
    editorMock.state.document = createDocument('Empty');
    render(<TokenSyncPanel />);
    expect(
      screen.getByRole('button', { name: /export dtcg file/i }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('routes a resolver file through the resolver workflow', async () => {
    editorMock.state.document = createDocument('Fresh');
    render(<TokenSyncPanel />);
    await pickFile(
      'theme.resolver.json',
      JSON.stringify({
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
          theme: { contexts: { light: [], dark: [] }, default: 'light' },
        },
        resolutionOrder: [{ $ref: '#/sets/core' }, { $ref: '#/modifiers/theme' }],
      }),
    );
    expect(screen.getByText('Resolver document')).toBeTruthy();
    expect(screen.getByLabelText('Context: theme')).toBeTruthy();
    expect(screen.getByText(/1 tokens ready to import/)).toBeTruthy();
  });
});

/** Seed a document whose source owns one token, with a captured base. */
function seedOwnedToken(localValue: number, baseValue: number): Document {
  return seedDoc((sync) => {
    addCleanSource(sync);
    sync.store = addToken(sync.store, {
      id: 'tok_a',
      path: ['a'],
      displayName: 'a',
      type: 'number',
      value: localValue,
      extensions: {},
      source: {
        sourceId: 'src_one',
        sourceFileId: 'tokens.json',
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
  });
}

describe('TokenSyncPanel external updates', () => {
  it('shows an update preview for a re-imported source', async () => {
    editorMock.state.document = seedOwnedToken(1, 1);
    render(<TokenSyncPanel />);
    await pickFile('tokens.json', '{"a": {"$type": "number", "$value": 2}}');
    expect(screen.getByText(/1 updated from tokens.json/)).toBeTruthy();
    const apply = screen.getByRole('button', { name: /apply update/i }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });

  it('requires an explicit decision for a concurrent edit', async () => {
    editorMock.state.document = seedOwnedToken(2, 1);
    render(<TokenSyncPanel />);
    await pickFile('tokens.json', '{"a": {"$type": "number", "$value": 3}}');
    expect(screen.getByText(/changed on both sides/)).toBeTruthy();
    const blocked = screen.getByRole('button', { name: /apply update/i }) as HTMLButtonElement;
    // With a disabledReason the control stays focusable and reports
    // aria-disabled, so the unavailable state is still announced.
    expect(blocked.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Use source value for a/i }));
    const enabled = screen.getByRole('button', { name: /apply update/i }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    expect(enabled.getAttribute('aria-disabled')).toBeNull();
  });

  it('applies the resolved remote value and announces the update', async () => {
    editorMock.state.document = seedOwnedToken(2, 1);
    render(<TokenSyncPanel />);
    await pickFile('tokens.json', '{"a": {"$type": "number", "$value": 3}}');
    fireEvent.click(screen.getByRole('button', { name: /Use source value for a/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply update/i }));

    expect(editorMock.announce).toHaveBeenCalledWith(
      expect.stringContaining('Updated tokens.json: 1 updated'),
    );
    const doc = editorMock.state.document as unknown as {
      variableStore: { tokenSync: { store: { tokens: Record<string, { value: unknown }> } } };
    };
    expect(doc.variableStore.tokenSync.store.tokens.tok_a?.value).toBe(3);
  });
});

function addSourceNamed(
  sync: ReturnType<typeof createEmptyTokenSynchronization>,
  id: string,
  name: string,
  file: string,
) {
  sync.store = addSource(sync.store, {
    id: id as `src_${string}`,
    name,
    kind: 'local-file',
    direction: 'import-only',
    adapterId: 'dtcg-2025.10',
    configuration: {
      entryFiles: [file],
      direction: 'import-only',
      stableIdPolicy: 'annotate',
    },
    syncState: { status: 'clean' },
  });
}

function addSourceToken(
  sync: ReturnType<typeof createEmptyTokenSynchronization>,
  id: string,
  path: string[],
  sourceId: string,
  value: unknown,
  type = 'number',
) {
  sync.store = addToken(sync.store, {
    id,
    path,
    displayName: path[path.length - 1],
    type,
    value,
    extensions: {},
    source: {
      sourceId: sourceId as `src_${string}`,
      sourceFileId: sourceId,
      sourcePointer: `/${path.join('/')}`,
      adapterId: 'dtcg-2025.10',
      specificationVersion: '2025.10',
    },
    localState: {
      createdLocally: false,
      detachedFromSource: false,
      locallyModified: false,
      unresolved: false,
      conflicted: false,
    },
  } as never).store;
}

function twoSourceDocument(): Document {
  return seedDoc((sync) => {
    addSourceNamed(sync, 'src_a', 'brand.tokens.json', 'brand.tokens.json');
    addSourceNamed(sync, 'src_b', 'brand2.tokens.json', 'brand2.tokens.json');
    addSourceToken(sync, 'tok_primary', ['color', 'primary'], 'src_a', 4);
    addSourceToken(sync, 'tok_gap', ['spacing', 'gap'], 'src_b', 8);
  });
}

async function openSelect(label: string, optionName: string) {
  const trigger = screen.getByRole('combobox', { name: label });
  fireEvent.click(trigger);
  const option = await screen.findByRole('option', { name: optionName });
  fireEvent.click(option);
}

describe('TokenSyncPanel multi-source', () => {
  it('lists every source with its own name and status', () => {
    editorMock.state.document = twoSourceDocument();
    render(<TokenSyncPanel />);
    // Scoped to the row: the detail panel and the source menu repeat names.
    expect(
      screen.getByText('brand.tokens.json', { selector: '.token-sync-panel__source-name' }),
    ).toBeTruthy();
    expect(
      screen.getByText('brand2.tokens.json', { selector: '.token-sync-panel__source-name' }),
    ).toBeTruthy();
    expect(
      screen.getAllByText('In sync', {
        selector: '.token-sync-panel__source-meta .token-sync-status',
      }),
    ).toHaveLength(2);
    // The detail shows the *selected* source only — both rows exist above it,
    // but exactly one source is previewed at a time.
    expect(screen.getByLabelText('Tokens in brand.tokens.json')).toBeTruthy();
    expect(screen.queryByLabelText('Tokens in brand2.tokens.json')).toBeNull();
  });

  it('previews only the selected source when the source is switched', async () => {
    editorMock.state.document = twoSourceDocument();
    render(<TokenSyncPanel />);

    // The first source is selected by default and shows its own tokens.
    expect(screen.getByLabelText('Tokens in brand.tokens.json').textContent).toContain(
      'color.primary',
    );

    await openSelect('Source', 'brand2.tokens.json');
    const selected = screen.getByLabelText('Tokens in brand2.tokens.json');
    expect(selected.textContent).toContain('spacing.gap');
    expect(selected.textContent).not.toContain('color.primary');
  });

  it('rejects non-DTCG source content with an error notice and applies nothing', () => {
    editorMock.state.document = twoSourceDocument();
    render(<TokenSyncPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit source content' }));
    const editor = screen.getByLabelText(/Source content:/) as HTMLTextAreaElement;
    // The editor opens on this source's own tokens (nested DTCG, not paths).
    expect(editor.value).toContain('"primary"');
    expect(editor.value).toContain('"color"');

    fireEvent.change(editor, { target: { value: 'this is definitely not tokens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview' }));

    const notice = screen.getByRole('alert');
    expect(notice.textContent).toMatch(/is not a JSON object and cannot be imported/i);
    expect(notice.textContent).toMatch(/nothing was changed/i);

    // Nothing was applied: both sources and both token lists survive intact.
    expect(
      screen.getByText('brand.tokens.json', { selector: '.token-sync-panel__source-name' }),
    ).toBeTruthy();
    expect(
      screen.getByText('brand2.tokens.json', { selector: '.token-sync-panel__source-name' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Tokens in brand.tokens.json').textContent).toContain(
      'color.primary',
    );
    expect(editorMock.state.document).toBeTruthy();
  });

  it('keeps every other action working after a rejected edit', async () => {
    editorMock.state.document = twoSourceDocument();
    render(<TokenSyncPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit source content' }));
    fireEvent.change(screen.getByLabelText(/Source content:/), {
      target: { value: '{ not json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview' }));
    expect(screen.getByRole('alert')).toBeTruthy();

    // Export is still available (the document has tokens).
    const exportButton = screen.getByRole('button', {
      name: 'Export DTCG file',
    }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(false);

    // Cancelling the edit clears the notice and returns to the panel.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText(/Source content:/)).toBeNull();

    // Switching sources still works.
    await openSelect('Source', 'brand.tokens.json');
    expect(screen.getByLabelText('Tokens in brand.tokens.json').textContent).toContain(
      'color.primary',
    );
  });
});

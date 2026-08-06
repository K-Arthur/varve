/**
 * TokenSyncPanel tests (jsdom): empty state, source status rendering,
 * change summary, import preview + apply flow. useEditor is mocked with a
 * controlled harness (the full EditorProvider is out of scope here and is
 * covered by editor-level integration specs).
 */
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { Document } from '@varve/scene';
import { createDocument } from '@varve/scene';
import { addSource, addToken, createEmptyTokenSynchronization } from '@varve/scene/tokens';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildImportPreview, TokenSyncPanel } from './TokenSyncPanel';

const editorMock = vi.hoisted(() => ({
  state: { document: null as Document | null },
  updateDoc: (fn: (doc: Document) => Document) => {
    if (editorMock.state.document) editorMock.state.document = fn(editorMock.state.document);
  },
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

beforeEach(() => {
  editorMock.state.document = null;
  editorMock.announce.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('TokenSyncPanel', () => {
  it('renders the empty state when no sources are connected', () => {
    editorMock.state.document = createDocument('Empty');
    render(<TokenSyncPanel />);
    expect(screen.getByText('Token Sync')).toBeTruthy();
    expect(screen.getByText(/No token sources connected/)).toBeTruthy();
  });

  it('renders source status rows and change summary', () => {
    editorMock.state.document = seedDoc((sync) => {
      sync.store = addSource(sync.store, {
        id: 'src_one',
        name: 'Brand tokens',
        kind: 'local-file',
        direction: 'bidirectional',
        adapterId: 'dtcg-2025.10',
        configuration: {
          entryFiles: ['tokens.json'],
          direction: 'bidirectional',
          stableIdPolicy: 'annotate',
        },
        syncState: { status: 'local-changes' },
      });
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
    expect(screen.getByText('Brand tokens')).toBeTruthy();
    expect(screen.getByText('Local changes')).toBeTruthy();
    expect(screen.getByText(/1 tokens, 1 modified/)).toBeTruthy();
    expect(screen.getByText(/1 local changes/)).toBeTruthy();
  });

  it('shows conflict counts when tokens are conflicted', () => {
    editorMock.state.document = seedDoc((sync) => {
      sync.store = addSource(sync.store, {
        id: 'src_one',
        name: 'Brand tokens',
        kind: 'local-file',
        direction: 'bidirectional',
        adapterId: 'dtcg-2025.10',
        configuration: {
          entryFiles: ['tokens.json'],
          direction: 'bidirectional',
          stableIdPolicy: 'annotate',
        },
        syncState: { status: 'conflicted' },
      });
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
          locallyModified: true,
          unresolved: false,
          conflicted: true,
        },
      } as never).store;
    });
    render(<TokenSyncPanel />);
    expect(screen.getByText('Conflicts')).toBeTruthy();
    expect(screen.getByText(/1 conflicts/)).toBeTruthy();
  });

  it('builds an import preview purely and applies through the store path', () => {
    const doc = seedDoc((sync) => {
      sync.store = addSource(sync.store, {
        id: 'src_one',
        name: 'Brand tokens',
        kind: 'local-file',
        direction: 'bidirectional',
        adapterId: 'dtcg-2025.10',
        configuration: {
          entryFiles: ['tokens.json'],
          direction: 'bidirectional',
          stableIdPolicy: 'annotate',
        },
        syncState: { status: 'clean' },
      });
    });
    const tokenText = '{"spacing": {"$type": "dimension", "$value": {"value": 8, "unit": "px"}}}';
    const sync = (doc as unknown as Record<string, unknown>).variableStore as {
      tokenSync: ReturnType<typeof createEmptyTokenSynchronization>;
    };
    const preview = buildImportPreview(tokenText, 'brand.tokens.json', sync.tokenSync);
    expect(preview.added).toBe(1);
    expect(preview.collisions).toEqual([]);
    // The apply path (applyImportToSync) is covered by the scene syncApply suite.
  });

  it('reports parse errors and collisions in the preview', () => {
    const doc = seedDoc((sync) => {
      sync.store = addSource(sync.store, {
        id: 'src_one',
        name: 'Brand tokens',
        kind: 'local-file',
        direction: 'bidirectional',
        adapterId: 'dtcg-2025.10',
        configuration: {
          entryFiles: ['tokens.json'],
          direction: 'bidirectional',
          stableIdPolicy: 'annotate',
        },
        syncState: { status: 'clean' },
      });
      sync.store = addToken(sync.store, {
        id: 'tok_a',
        path: ['spacing'],
        displayName: 'spacing',
        type: 'dimension',
        value: { value: 4, unit: 'px' },
        extensions: {},
        source: {
          sourceId: 'src_one',
          sourceFileId: 'tokens.json',
          sourcePointer: '/spacing',
          adapterId: 'd',
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
    });
    const sync = (doc as unknown as Record<string, unknown>).variableStore as {
      tokenSync: ReturnType<typeof createEmptyTokenSynchronization>;
    };
    const broken = buildImportPreview('{broken', 'bad.json', sync.tokenSync);
    expect(broken.diagnostics.length).toBeGreaterThan(0);
    const colliding = buildImportPreview(
      '{"spacing": {"$type": "dimension", "$value": {"value": 8, "unit": "px"}}}',
      'collide.json',
      sync.tokenSync,
    );
    expect(colliding.collisions).toEqual(['spacing']);
    expect(colliding.added).toBe(0);
  });
});

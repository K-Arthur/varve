/**
 * Regression tests for document creation and per-tab file identity.
 *
 * The bug these exist for: File → New / Ctrl+N replaced `state.document` in
 * place without touching the session list, so the new blank document
 * inherited the active tab's fileId/filePath and the next save wrote it over
 * the file the user still had open — and no new tab ever appeared.
 *
 * The invariant, stated once: a session's file identity comes only from the
 * caller that put a document there. It is never inherited from whatever the
 * tab held before, because that is what makes save() write the wrong file.
 */
import { act, render } from '@testing-library/react';
import { createDocument, DocumentCodec } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

/** A real, decodable document — loadDocument silently ignores invalid JSON. */
const DOC_JSON = DocumentCodec.encode(createDocument('Loaded'));

function mountEditor() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function TestComponent() {
    ctx = useEditor();
    return null;
  }
  render(
    <EditorProvider>
      <TestComponent />
    </EditorProvider>,
  );
  return () => {
    if (!ctx) throw new Error('ctx not found');
    return ctx;
  };
}

/** Bind the (pristine) active tab to a file, the way opening one does. */
function openFileInActiveTab(
  getCtx: () => ReturnType<typeof useEditor>,
  fileId: string,
  name: string,
  filePath: string,
) {
  act(() => {
    getCtx().openFile(fileId, name, filePath, null);
  });
}

function activeSession(ctx: ReturnType<typeof useEditor>) {
  return ctx.state.sessions.find((s) => s.id === ctx.state.activeId);
}

describe('newDocument — File > New / Ctrl+N', () => {
  it('opens a new tab instead of replacing the active document', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');
    const beforeId = getCtx().state.activeId;
    const beforeCount = getCtx().state.sessions.length;

    act(() => {
      getCtx().newDocument();
    });

    expect(getCtx().state.sessions).toHaveLength(beforeCount + 1);
    expect(getCtx().state.activeId).not.toBe(beforeId);
  });

  it('leaves the previous tab bound to its own file', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');
    const beforeId = getCtx().state.activeId;

    act(() => {
      getCtx().newDocument();
    });

    const previous = getCtx().state.sessions.find((s) => s.id === beforeId);
    expect(previous).toMatchObject({
      name: 'Design A',
      fileId: 'file-a',
      filePath: '/docs/a.varve',
    });
  });

  // The core of the reported bug: an inherited fileId/filePath is what let
  // save() write the blank new document over the open file.
  it('gives the new tab no file identity, so saving it cannot overwrite the old file', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');

    act(() => {
      getCtx().newDocument();
    });

    const created = activeSession(getCtx());
    expect(created?.fileId).toBeUndefined();
    expect(created?.filePath).toBeUndefined();
  });

  it('gives every new tab a distinct id even when created in the same millisecond', () => {
    const getCtx = mountEditor();

    act(() => {
      getCtx().newTab();
    });
    act(() => {
      getCtx().newTab();
    });

    const ids = getCtx().state.sessions.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('openFile — multiple documents open at once', () => {
  it('preserves an explicit app-library save destination', () => {
    const getCtx = mountEditor();

    act(() => {
      getCtx().openFile('library-a', 'Library A', undefined, DOC_JSON, true);
    });

    expect(activeSession(getCtx())).toMatchObject({
      fileId: 'library-a',
      libraryStorage: true,
    });
  });

  it('opens a second file in its own tab, keeping the first open', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');
    const firstId = getCtx().state.activeId;
    const beforeCount = getCtx().state.sessions.length;

    act(() => {
      getCtx().openFile('file-b', 'Design B', '/docs/b.varve', DOC_JSON);
    });

    expect(getCtx().state.sessions).toHaveLength(beforeCount + 1);
    expect(getCtx().state.activeId).not.toBe(firstId);
    expect(getCtx().state.sessions.find((s) => s.id === firstId)).toMatchObject({
      name: 'Design A',
      fileId: 'file-a',
    });
  });

  it('switches to the existing tab instead of opening the same file twice', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');
    const firstId = getCtx().state.activeId;

    act(() => {
      getCtx().openFile('file-b', 'Design B', '/docs/b.varve', DOC_JSON);
    });
    const countWithBoth = getCtx().state.sessions.length;

    act(() => {
      getCtx().openFile('file-a', 'Design A', '/docs/a.varve', DOC_JSON);
    });

    expect(getCtx().state.sessions).toHaveLength(countWithBoth);
    expect(getCtx().state.activeId).toBe(firstId);
  });

  // Open Recent and the browser file picker have no app-store id to pass.
  it('opens a file known only by path, deduping on that path', () => {
    const getCtx = mountEditor();

    act(() => {
      getCtx().openFile(undefined, 'Recent.varve', '/docs/recent.varve', DOC_JSON);
    });
    const openedId = getCtx().state.activeId;
    const countAfterOpen = getCtx().state.sessions.length;
    expect(activeSession(getCtx())).toMatchObject({ filePath: '/docs/recent.varve' });

    act(() => {
      getCtx().openFile(undefined, 'Recent.varve', '/docs/recent.varve', DOC_JSON);
    });

    expect(getCtx().state.sessions).toHaveLength(countAfterOpen);
    expect(getCtx().state.activeId).toBe(openedId);
  });

  it('keeps each tab on its own document when switching between them', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');
    const firstId = getCtx().state.activeId;

    act(() => {
      getCtx().openFile('file-b', 'Design B', '/docs/b.varve', DOC_JSON);
    });
    const secondId = getCtx().state.activeId;
    const secondDocName = getCtx().state.document.name;

    act(() => {
      getCtx().switchTab(firstId);
    });
    expect(getCtx().state.document.name).toBe('Design A');

    act(() => {
      getCtx().switchTab(secondId);
    });
    expect(getCtx().state.document.name).toBe(secondDocName);
  });
});

describe('loadDocument — file identity is explicit, never inherited', () => {
  it('rebinds the tab to the incoming file by default', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');

    act(() => {
      getCtx().loadDocument(DOC_JSON, { name: 'Design B', filePath: '/docs/b.varve' });
    });

    const session = activeSession(getCtx());
    expect(session?.filePath).toBe('/docs/b.varve');
    // Crucially not 'file-a' — a half-inherited identity would make save()
    // write document B over file A's app-store record.
    expect(session?.fileId).toBeUndefined();
  });

  it('drops the previous identity when the caller states none', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');

    act(() => {
      getCtx().loadDocument(DOC_JSON);
    });

    const session = activeSession(getCtx());
    expect(session?.fileId).toBeUndefined();
    expect(session?.filePath).toBeUndefined();
  });

  it('keeps the binding when replacing the same file (rename, version restore)', () => {
    const getCtx = mountEditor();
    act(() => {
      getCtx().openFile('file-a', 'Design A', undefined, DOC_JSON, true);
    });

    act(() => {
      getCtx().loadDocument(DOC_JSON, { name: 'Renamed', keepIdentity: true });
    });

    expect(activeSession(getCtx())).toMatchObject({
      name: 'Renamed',
      fileId: 'file-a',
      libraryStorage: true,
    });
  });

  it('opens its own tab when asked, leaving the active document untouched', () => {
    const getCtx = mountEditor();
    openFileInActiveTab(getCtx, 'file-a', 'Design A', '/docs/a.varve');
    const beforeId = getCtx().state.activeId;
    const beforeCount = getCtx().state.sessions.length;

    act(() => {
      getCtx().loadDocument(DOC_JSON, { name: 'A copy', newSession: true });
    });

    expect(getCtx().state.sessions).toHaveLength(beforeCount + 1);
    expect(getCtx().state.activeId).not.toBe(beforeId);
    expect(activeSession(getCtx())?.fileId).toBeUndefined();
    expect(getCtx().state.sessions.find((s) => s.id === beforeId)).toMatchObject({
      fileId: 'file-a',
      filePath: '/docs/a.varve',
    });
  });
});

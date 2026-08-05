/**
 * Session baselines — single-window editor session behavior captured
 * BEFORE any multi-window work lands (2026-08-05).
 *
 * These pin the canonical-session contracts that a session broker must
 * preserve when auxiliary windows appear:
 *
 * 1. Default workspace mode and panel visibility at boot.
 * 2. Visibility toggles persist through the editor settings store.
 * 3. Active-document switching (newTab/switchTab) preserves per-session
 *    document identity and undo stacks.
 * 4. updateDoc pushes exactly one undo step; undo/redo restore document
 *    snapshots.
 * 5. Selection updates propagate through the SelectionProvider into
 *    EditorState.
 */

// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, render, waitFor } from '@testing-library/react';
import { addChild, addNode, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { useSelection } from '../../context/SelectionContext';
import { loadSettings } from '../../settings';

function documentWithRect(name: string, shapeId: string) {
  const doc = createDocument(name);
  let updated = addNode(doc, makeShapeNode(shapeId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }));
  const parentId = updated.rootChildren[0] ?? shapeId;
  const node = updated.nodes[shapeId];
  if (node) {
    updated = addChild(updated, parentId, node);
  }
  return JSON.stringify(updated);
}

type EditorCtx = ReturnType<typeof useEditor>;

function mountEditor(initialDocumentJson?: string) {
  let ctx: EditorCtx | undefined;
  function Harness() {
    ctx = useEditor();
    return null;
  }
  render(
    <EditorProvider initialDocumentJson={initialDocumentJson}>
      <Harness />
    </EditorProvider>,
  );
  return () => {
    if (!ctx) throw new Error('ctx not ready');
    return ctx;
  };
}

describe('session baseline: boot state', () => {
  it('starts in design mode with both side panels visible', async () => {
    const getCtx = mountEditor();
    await waitFor(() => expect(getCtx().state.workspaceMode).toBe('design'));
    expect(getCtx().state.leftPanelVisible).toBe(true);
    expect(getCtx().state.rightPanelVisible).toBe(true);
  });

  it('has exactly one boot session and an empty selection', async () => {
    const getCtx = mountEditor();
    await waitFor(() => expect(getCtx().state.activeId).toBeTruthy());
    expect(getCtx().state.sessions).toHaveLength(1);
    expect(getCtx().state.selection).toEqual([]);
    expect(getCtx().state.canUndo).toBe(false);
  });
});

describe('session baseline: panel visibility persistence', () => {
  it('toggleLeftPanel flips state and persists to varve-editor-settings', async () => {
    const getCtx = mountEditor();
    await waitFor(() => expect(getCtx().state.leftPanelVisible).toBe(true));

    act(() => getCtx().toggleLeftPanel());
    expect(getCtx().state.leftPanelVisible).toBe(false);
    expect(loadSettings().panel.leftPanelVisible).toBe(false);

    act(() => getCtx().toggleLeftPanel());
    expect(getCtx().state.leftPanelVisible).toBe(true);
    expect(loadSettings().panel.leftPanelVisible).toBe(true);
  });

  it('toggleRightPanel persists independently of the left panel', async () => {
    const getCtx = mountEditor();
    await waitFor(() => expect(getCtx().state.rightPanelVisible).toBe(true));

    act(() => getCtx().toggleRightPanel());
    expect(loadSettings().panel.leftPanelVisible).toBe(true);
    expect(loadSettings().panel.rightPanelVisible).toBe(false);
  });
});

describe('session baseline: multi-document switching', () => {
  it('newTab creates a second session; switchTab restores the original document', async () => {
    const getCtx = mountEditor();
    await waitFor(() => expect(getCtx().state.sessions).toHaveLength(1));
    const firstSessionId = getCtx().state.activeId;
    const firstName = getCtx().state.document.name;

    act(() => getCtx().newTab());
    expect(getCtx().state.sessions).toHaveLength(2);
    expect(getCtx().state.activeId).not.toBe(firstSessionId);

    act(() => getCtx().switchTab(firstSessionId));
    expect(getCtx().state.activeId).toBe(firstSessionId);
    expect(getCtx().state.document.name).toBe(firstName);
  });

  it('keeps undo stacks per session across tab switches', async () => {
    const getCtx = mountEditor();
    await waitFor(() => expect(getCtx().state.activeId).toBeTruthy());
    const firstSessionId = getCtx().state.activeId;
    const originalNextId = getCtx().state.document.nextId;

    act(() => getCtx().updateDoc((doc) => ({ ...doc, nextId: doc.nextId + 1 })));
    expect(getCtx().state.canUndo).toBe(true);

    act(() => getCtx().newTab());
    expect(getCtx().state.canUndo).toBe(false);

    act(() => getCtx().switchTab(firstSessionId));
    expect(getCtx().state.document.nextId).toBe(originalNextId + 1);
    expect(getCtx().state.canUndo).toBe(true);
  });
});

describe('session baseline: undo/redo', () => {
  it('updateDoc pushes one undo step; undo and redo restore snapshots', async () => {
    const getCtx = mountEditor();
    await waitFor(() => expect(getCtx().state.activeId).toBeTruthy());
    const originalNextId = getCtx().state.document.nextId;

    act(() => getCtx().updateDoc((doc) => ({ ...doc, nextId: doc.nextId + 1 })));
    act(() => getCtx().updateDoc((doc) => ({ ...doc, nextId: doc.nextId + 1 })));
    expect(getCtx().state.document.nextId).toBe(originalNextId + 2);
    expect(getCtx().state.canUndo).toBe(true);

    act(() => getCtx().undo());
    expect(getCtx().state.document.nextId).toBe(originalNextId + 1);
    expect(getCtx().state.canRedo).toBe(true);

    act(() => getCtx().redo());
    expect(getCtx().state.document.nextId).toBe(originalNextId + 2);
    expect(getCtx().state.canRedo).toBe(false);
  });
});

describe('session baseline: selection propagation', () => {
  it('setSelection updates EditorState selection and bumps the revision', async () => {
    let selection: ReturnType<typeof useSelection> | undefined;
    function Harness() {
      selection = useSelection();
      return null;
    }
    render(
      <EditorProvider initialDocumentJson={documentWithRect('Selections', 'shape-1')}>
        <Harness />
      </EditorProvider>,
    );
    await waitFor(() => expect(selection).toBeDefined());
    const revisionBefore = selection?.selectionRevision ?? -1;

    act(() => selection?.setSelection('shape-1'));
    expect(selection?.selection).toEqual(['shape-1']);
    expect(selection?.primaryId).toBe('shape-1');
    if (selection) {
      expect(selection.selectionRevision).toBeGreaterThan(revisionBefore);
    }
  });
});

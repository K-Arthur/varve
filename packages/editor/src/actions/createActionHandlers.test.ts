import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { setStartTextEditingHandler } from '../context';
import { createActionHandlers } from './createActionHandlers';

function makeEditorMock(overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  return {
    setInspectorTab: vi.fn(),
    setTool: vi.fn(),
    enterIsolation: vi.fn(),
    announce: vi.fn(),
    ...overrides,
  } as unknown as EditorContextValue;
}

describe('createActionHandlers — tool actions', () => {
  it.each([
    ['toolScale', 'scale'],
    ['toolSlice', 'slice'],
    ['toolCloneStamp', 'cloneStamp'],
  ] as const)('%s switches to its tool', (action, tool) => {
    const editor = makeEditorMock();
    createActionHandlers(editor)[action]?.();
    expect(editor.setTool).toHaveBeenCalledWith(tool);
  });
});

describe('createActionHandlers — enterFrame', () => {
  it('calls enterIsolation when a frame is selected', () => {
    const frameId = 'f1';
    const editor = makeEditorMock({
      state: {
        selection: [frameId],
        document: {
          nodes: {
            [frameId]: { id: frameId, kind: 'frame', name: 'Frame 1' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).enterFrame?.();
    expect(editor.enterIsolation).toHaveBeenCalledWith(frameId);
    expect(editor.announce).toHaveBeenCalled();
  });

  it('calls enterIsolation when a group is selected', () => {
    const groupId = 'g1';
    const editor = makeEditorMock({
      state: {
        selection: [groupId],
        document: {
          nodes: {
            [groupId]: { id: groupId, kind: 'group', name: 'Group 1' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).enterFrame?.();
    expect(editor.enterIsolation).toHaveBeenCalledWith(groupId);
  });

  it('does nothing for non-container nodes', () => {
    const editor = makeEditorMock({
      state: {
        selection: ['r1'],
        document: {
          nodes: {
            r1: { id: 'r1', kind: 'shape', name: 'Rect 1' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).enterFrame?.();
    expect(editor.enterIsolation).not.toHaveBeenCalled();
  });

  it('does nothing for multi-selection', () => {
    const editor = makeEditorMock({
      state: {
        selection: ['f1', 'f2'],
        document: {
          nodes: {
            f1: { id: 'f1', kind: 'frame' },
            f2: { id: 'f2', kind: 'frame' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).enterFrame?.();
    expect(editor.enterIsolation).not.toHaveBeenCalled();
  });
});

describe('createActionHandlers — editText', () => {
  it('calls startTextEditing when a text node is selected', () => {
    const textId = 't1';
    const startTextEdit = vi.fn();
    setStartTextEditingHandler(startTextEdit);
    const editor = makeEditorMock({
      state: {
        selection: [textId],
        document: {
          nodes: {
            [textId]: { id: textId, kind: 'text', name: 'Text 1' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).editText?.();
    expect(startTextEdit).toHaveBeenCalledWith(textId);
    setStartTextEditingHandler(null);
  });

  it('does nothing for non-text nodes', () => {
    const startTextEdit = vi.fn();
    setStartTextEditingHandler(startTextEdit);
    const editor = makeEditorMock({
      state: {
        selection: ['r1'],
        document: {
          nodes: {
            r1: { id: 'r1', kind: 'shape' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).editText?.();
    expect(startTextEdit).not.toHaveBeenCalled();
    setStartTextEditingHandler(null);
  });
});

describe('createActionHandlers — intelligence menu actions', () => {
  it('runAudit opens the audit tab', () => {
    const editor = makeEditorMock();
    const handlers = createActionHandlers(editor);
    handlers.runAudit?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'audit');
  });

  it('scanDebt opens the debt tab', () => {
    const editor = makeEditorMock();
    const handlers = createActionHandlers(editor);
    handlers.scanDebt?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'debt');
  });

  it('suggestNames opens the naming tab', () => {
    const editor = makeEditorMock();
    const handlers = createActionHandlers(editor);
    handlers.suggestNames?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'naming');
  });

  it('detectDuplicates opens the components tab', () => {
    const editor = makeEditorMock();
    const handlers = createActionHandlers(editor);
    handlers.detectDuplicates?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'components');
  });

  it.each([
    ['openInspectorProperties', 'properties'],
    ['openAppearancePanel', 'appearance'],
    ['openAdjustmentsPanel', 'adjustments'],
    ['openPrototypePanel', 'prototype'],
    ['openFontsPanel', 'fonts'],
    ['openExportPanel', 'export'],
    ['openAuditPanel', 'audit'],
  ] as const)('%s deep-links to its inspector workflow', (action, tab) => {
    const editor = makeEditorMock();
    createActionHandlers(editor)[action]?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith(tab);
  });

  it('opens document settings at the canonical empty-selection Properties surface', () => {
    const editor = makeEditorMock({ setSelection: vi.fn() });
    createActionHandlers(editor).openDocumentPanel?.();
    expect(editor.setSelection).toHaveBeenCalledWith(null);
    expect(editor.setInspectorTab).toHaveBeenCalledWith('properties');
  });

  it('opens inspection through the real inspect tool and Export surface', () => {
    const editor = makeEditorMock();
    createActionHandlers(editor).openInspectPanel?.();
    expect(editor.setTool).toHaveBeenCalledWith('inspect');
    expect(editor.setInspectorTab).toHaveBeenCalledWith('export');
  });
});

describe('createActionHandlers — text formatting', () => {
  it('updates text immutably and toggles numeric font weight', () => {
    const originalNode = {
      id: 't1',
      kind: 'text',
      text: 'Hello',
      fontSize: 16,
      fontWeight: 400,
    };
    const document = {
      nodes: { t1: originalNode },
    };
    let updatedDocument: typeof document | undefined;
    const editor = makeEditorMock({
      state: {
        selection: ['t1'],
        document,
      } as unknown as EditorContextValue['state'],
      updateDoc: vi.fn((update) => {
        updatedDocument = update(document as never) as unknown as typeof document;
      }),
    });

    createActionHandlers(editor).textBold?.();

    expect(updatedDocument).not.toBe(document);
    expect(updatedDocument?.nodes).not.toBe(document.nodes);
    expect(updatedDocument?.nodes.t1).not.toBe(originalNode);
    expect(updatedDocument?.nodes.t1.fontWeight).toBe(700);
    expect(originalNode.fontWeight).toBe(400);
  });
});

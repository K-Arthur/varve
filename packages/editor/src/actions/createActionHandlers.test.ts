import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { createActionHandlers } from './createActionHandlers';

function makeEditorMock(overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  return {
    setInspectorTab: vi.fn(),
    ...overrides,
  } as unknown as EditorContextValue;
}

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
});

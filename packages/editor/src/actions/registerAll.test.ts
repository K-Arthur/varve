import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { getActionRegistry, resetActionRegistryForTesting } from './ActionRegistry';
import { registerEditorActions } from './registerAll';

function makeEditorMock(overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  return {
    setInspectorTab: vi.fn(),
    state: { selection: [], pixelGridEnabled: false },
    toggleLeftPanel: vi.fn(),
    toggleRightPanel: vi.fn(),
    setPixelGridEnabled: vi.fn(),
    ...overrides,
  } as unknown as EditorContextValue;
}

describe('registerEditorActions — intelligence commands', () => {
  afterEach(() => {
    resetActionRegistryForTesting();
  });

  it('registers Audit, Scan for Debt, Suggest Names, and Detect Duplicates', () => {
    const editor = makeEditorMock();
    registerEditorActions(editor);
    const r = getActionRegistry();
    expect(r.has('runAudit')).toBe(true);
    expect(r.has('scanDebt')).toBe(true);
    expect(r.has('suggestNames')).toBe(true);
    expect(r.has('detectDuplicates')).toBe(true);
  });

  it('registered intelligence actions dispatch to setInspectorTab when executed', () => {
    const editor = makeEditorMock();
    registerEditorActions(editor);
    const r = getActionRegistry();
    r.get('scanDebt')?.handler(undefined);
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'debt');
  });

  it('makes intelligence commands searchable in the action registry', () => {
    const editor = makeEditorMock();
    registerEditorActions(editor);
    const r = getActionRegistry();
    expect(r.search('debt')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'scanDebt' })]),
    );
    expect(r.search('contrast')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'runAudit' })]),
    );
  });

  it('registers searchable commands for every durable inspector workflow', () => {
    registerEditorActions(makeEditorMock());
    const registry = getActionRegistry();

    for (const id of [
      'openInspectorProperties',
      'openAppearancePanel',
      'openAdjustmentsPanel',
      'openPrototypePanel',
      'openDocumentPanel',
      'openExportPanel',
      'openInspectPanel',
      'openAuditPanel',
    ]) {
      expect(registry.has(id), id).toBe(true);
    }
    expect(registry.search('retouch')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'openAdjustmentsPanel' })]),
    );
  });

  it('registers real clipping-mask handlers before shortcut stubs', () => {
    const editor = makeEditorMock({
      createClippingMaskFromSelected: vi.fn(),
      releaseClippingMaskFromSelected: vi.fn(),
    });
    registerEditorActions(editor);
    const registry = getActionRegistry();

    registry.get('createClippingMask')?.handler(undefined);
    registry.get('releaseClippingMask')?.handler(undefined);

    expect(editor.createClippingMaskFromSelected).toHaveBeenCalledOnce();
    expect(editor.releaseClippingMaskFromSelected).toHaveBeenCalledOnce();
  });
});

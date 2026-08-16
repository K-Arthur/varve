import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { getActionRegistry, resetActionRegistryForTesting } from './ActionRegistry';
import { openVarveContact, registerEditorActions } from './registerAll';

// `vi.mock` is hoisted above module-level `let`s, so the flag the factory
// closes over has to be hoisted with it.
const runtime = vi.hoisted(() => ({ isTauri: false }));

vi.mock('@varve/platform', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  isTauriRuntime: () => runtime.isTauri,
}));

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
      'openFontsPanel',
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

  it('registers visible non-shortcut menu commands with real handlers', () => {
    const onFindReplace = vi.fn();
    const editor = makeEditorMock();
    registerEditorActions(editor, { onFindReplace });

    const registry = getActionRegistry();
    for (const id of ['findReplace', 'textBold', 'inspectMode', 'resetWorkspace', 'about']) {
      expect(registry.has(id), id).toBe(true);
    }

    registry.get('findReplace')?.handler(undefined);
    expect(onFindReplace).toHaveBeenCalledOnce();
  });
});

/**
 * Contact links are a privacy surface, not just a convenience. Two things
 * must hold on every platform: the URL carries no user data, and the click
 * actually opens something. The Tauri branch exists because
 * `window.open('mailto:')` is silently ignored by WebKitGTK.
 */
describe('openVarveContact', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    runtime.isTauri = false;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    runtime.isTauri = false;
  });

  function stubLocation(): { current: string } {
    const href = { current: '' };
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        set href(value: string) {
          href.current = value;
        },
        get href() {
          return href.current;
        },
      },
    });
    return href;
  }

  it('navigates to the channel mailto on the web build', () => {
    const href = stubLocation();
    openVarveContact('support');
    expect(href.current).toBe('mailto:support@varve.studio?subject=Varve%20support');
  });

  it('hands the URL to the native opener under Tauri', () => {
    runtime.isTauri = true;
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
    const href = stubLocation();

    openVarveContact('security');

    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'mailto:security@varve.studio?subject=Varve%20security%20report',
    });
    // The webview must not also navigate — that would blank the editor.
    expect(href.current).toBe('');
  });

  it('survives a missing mail handler without throwing', async () => {
    runtime.isTauri = true;
    const invoke = vi.fn().mockRejectedValue(new Error('no handler'));
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };

    expect(() => openVarveContact('feedback')).not.toThrow();
    await Promise.resolve();
  });

  it('never puts anything but a short static subject in the URL', () => {
    const href = stubLocation();
    for (const channel of ['support', 'feedback', 'security', 'privacy'] as const) {
      openVarveContact(channel);
      expect(href.current).not.toMatch(/body=/);
      expect(href.current.length).toBeLessThan(120);
    }
  });
});

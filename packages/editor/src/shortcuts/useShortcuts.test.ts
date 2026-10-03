import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActionRegistry, resetActionRegistryForTesting } from '../actions/ActionRegistry';
import type { EditorContextValue } from '../context';
import { clearOverride, isMac, setOverride } from './ShortcutManager';
import { useShortcuts } from './useShortcuts';

afterEach(() => {
  cleanup();
  resetActionRegistryForTesting();
  clearOverride('save');
  document.body.replaceChildren();
});

describe('useShortcuts', () => {
  it('uses the local Quick Actions toggle when the registry entry is a placeholder', () => {
    getActionRegistry().register(
      { id: 'quickActions', label: 'Quick Actions', category: 'view', placeholder: true },
      () => {},
    );
    const editor = {
      state: { selectedGuideId: null, isolatedNodeId: null },
      recordAction: () => {},
    } as unknown as EditorContextValue;

    const { result } = renderHook(() => useShortcuts(editor));
    expect(result.current.quickActionsOpen).toBe(false);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ':',
          code: 'Semicolon',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });

    expect(result.current.quickActionsOpen).toBe(true);
  });

  it('captures undo and redo before the browser consumes canvas history shortcuts', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const editor = {
      state: { selectedGuideId: null, isolatedNodeId: null },
      recordAction: vi.fn(),
      undo,
      redo,
    } as unknown as EditorContextValue;

    renderHook(() => useShortcuts(editor));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          ctrlKey: true,
          cancelable: true,
          bubbles: true,
        }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          ctrlKey: true,
          shiftKey: true,
          cancelable: true,
          bubbles: true,
        }),
      );
    });

    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();
    expect(editor.recordAction).toHaveBeenNthCalledWith(1, 'shortcut:undo');
    expect(editor.recordAction).toHaveBeenNthCalledWith(2, 'shortcut:redo');
  });
});

describe('responsive Inspector Save routing', () => {
  function setup(control = '<button id="save-focus">Customize sections</button>', enabled = true) {
    const save = vi.fn();
    const other = vi.fn();
    getActionRegistry().register({ id: 'save', label: 'Save', category: 'file' }, save);
    getActionRegistry().register({ id: 'duplicate', label: 'Duplicate', category: 'edit' }, other);
    const editor = {
      state: { selectedGuideId: null, isolatedNodeId: null },
      recordAction: vi.fn(),
    } as unknown as EditorContextValue;
    renderHook(() => useShortcuts(editor, undefined, enabled));
    const drawer = document.createElement('aside');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('data-editor-shortcut-scope', 'inspector-history');
    drawer.innerHTML = control;
    document.body.append(drawer);
    const target = drawer.querySelector('#save-focus')!;
    return { save, other, editor, target };
  }

  function key(target: Element, key: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: !isMac(),
      metaKey: isMac(),
      bubbles: true,
      cancelable: true,
      ...options,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it('dispatches Save once from a drawer button and keeps other app shortcuts scoped', () => {
    const { save, other, editor, target } = setup();
    expect(key(target, 's').defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(editor.recordAction).toHaveBeenCalledExactlyOnceWith('shortcut:save');
    expect(key(target, 'd').defaultPrevented).toBe(false);
    expect(other).not.toHaveBeenCalled();
  });

  it('does not dispatch twice from the ordinary canvas/body path', () => {
    const { save } = setup();
    key(document.body, 's');
    expect(save).toHaveBeenCalledOnce();
  });

  it('uses the effective remapped Save binding in the drawer', () => {
    const { save, target } = setup();
    setOverride('save', { key: 'k', ctrl: true, alt: true });
    expect(key(target, 's').defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(key(target, 'k', { altKey: true }).defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it.each([
    '<input id="save-focus" value="Title" />',
    '<div role="slider" id="save-focus">Scale</div>',
    '<div role="dialog"><button id="save-focus">Parameters</button></div>',
    '<dialog open><button id="save-focus">Parameters</button></dialog>',
  ])('leaves Save ownership inside native editing or nested dialogs: %s', (control) => {
    const { save, target } = setup(control);
    expect(key(target, 's').defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('respects disabled shortcut routing', () => {
    const { save, target } = setup(undefined, false);
    key(target, 's');
    expect(save).not.toHaveBeenCalled();
  });

  it('does not dispatch composing or already-consumed Save events', () => {
    const { save, target } = setup();
    key(target, 's', { isComposing: true });
    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: !isMac(),
      metaKey: isMac(),
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    act(() => {
      target.dispatchEvent(event);
    });
    expect(save).not.toHaveBeenCalled();
  });
});

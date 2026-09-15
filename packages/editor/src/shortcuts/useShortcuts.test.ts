import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActionRegistry, resetActionRegistryForTesting } from '../actions/ActionRegistry';
import type { EditorContextValue } from '../context';
import { useShortcuts } from './useShortcuts';

afterEach(() => {
  cleanup();
  resetActionRegistryForTesting();
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
          key: ';',
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

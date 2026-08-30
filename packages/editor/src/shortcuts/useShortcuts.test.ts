import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
});

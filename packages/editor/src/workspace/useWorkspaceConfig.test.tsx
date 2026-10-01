/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEffectiveWorkspaceConfig } from './useWorkspaceConfig';
import {
  getWorkspacePreferences,
  resetWorkspacePreferenceCache,
  setPanelOverride,
  setWorkspacePreferences,
} from './workspaceStore';

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  resetWorkspacePreferenceCache();
});

describe('useEffectiveWorkspaceConfig', () => {
  it('keeps customized config identity stable until preferences change', () => {
    setWorkspacePreferences(
      setPanelOverride(getWorkspacePreferences(), 'email', 'layers', { visible: false }),
    );
    const { result, rerender } = renderHook(() => useEffectiveWorkspaceConfig('email'));
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);

    act(() => {
      setWorkspacePreferences(
        setPanelOverride(getWorkspacePreferences(), 'email', 'layers', { visible: true }),
      );
    });
    expect(result.current).not.toBe(first);
    expect(result.current.panels.layers.visible).toBe(true);
  });
});

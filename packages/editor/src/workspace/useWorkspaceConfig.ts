/**
 * useEffectiveWorkspaceConfig — reactive view of the effective workspace
 * configuration (built-in config + persisted user overrides).
 *
 * Shell and friends subscribe here so a preference change (panel toggle
 * recorded by the store) re-renders workspace-controlled surfaces without
 * threading the preferences through EditorState.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  isModeCustomized,
  subscribeWorkspacePreferences,
} from './workspaceStore';
import { ALL_WORKSPACE_MODES, type WorkspaceConfig, type WorkspaceMode } from './workspaceTypes';

export function useEffectiveWorkspaceConfig(mode: WorkspaceMode): WorkspaceConfig {
  const [prefs, setPrefs] = useState(getWorkspacePreferences);
  useEffect(() => subscribeWorkspacePreferences(() => setPrefs(getWorkspacePreferences())), []);
  return getEffectiveWorkspaceConfig(mode, prefs);
}

/**
 * Reactive per-mode customization flags. Returns a map from mode → boolean
 * so workspace tabs can show a "customized" dot without each tab subscribing
 * independently.
 */
export function useWorkspaceCustomizations(): Record<WorkspaceMode, boolean> {
  const [prefs, setPrefs] = useState(getWorkspacePreferences);
  useEffect(() => subscribeWorkspacePreferences(() => setPrefs(getWorkspacePreferences())), []);
  return useMemo(() => {
    const result = {} as Record<WorkspaceMode, boolean>;
    for (const mode of ALL_WORKSPACE_MODES) {
      result[mode] = isModeCustomized(prefs, mode);
    }
    return result;
  }, [prefs]);
}

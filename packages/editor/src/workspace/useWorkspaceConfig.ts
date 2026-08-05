/**
 * useEffectiveWorkspaceConfig — reactive view of the effective workspace
 * configuration (built-in config + persisted user overrides).
 *
 * Shell and friends subscribe here so a preference change (panel toggle
 * recorded by the store) re-renders workspace-controlled surfaces without
 * threading the preferences through EditorState.
 */

import { useEffect, useState } from 'react';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  subscribeWorkspacePreferences,
} from './workspaceStore';
import type { WorkspaceConfig, WorkspaceMode } from './workspaceTypes';

export function useEffectiveWorkspaceConfig(mode: WorkspaceMode): WorkspaceConfig {
  const [prefs, setPrefs] = useState(getWorkspacePreferences);
  useEffect(() => subscribeWorkspacePreferences(() => setPrefs(getWorkspacePreferences())), []);
  return getEffectiveWorkspaceConfig(mode, prefs);
}

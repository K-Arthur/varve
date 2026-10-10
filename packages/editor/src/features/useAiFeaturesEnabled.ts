/**
 * Hook to check if AI features are globally enabled.
 *
 * When AI is disabled:
 * - All AI entry points (menus, buttons, shortcuts) are hidden or disabled
 * - Model downloads and loading are blocked
 * - Inference pipelines refuse to run
 * - Background AI tasks (embeddings, etc.) are skipped
 *
 * Existing AI-edited content remains visible and editable, but no new
 * AI operations can be initiated.
 */

import { useSettings } from '../components/Settings/SettingsContext';

export function useAiFeaturesEnabled(): boolean {
  const { settings } = useSettings();
  return settings.ai.enabled;
}

/**
 * Synchronous check for AI features enabled state.
 * Use this in non-React contexts (menu handlers, IPC, workers).
 */
export function getAiFeaturesEnabled(): boolean {
  try {
    const raw = localStorage.getItem('varve-editor-settings');
    if (!raw) return true; // Default enabled
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ai = parsed.ai as Record<string, unknown> | undefined;
    return ai?.enabled !== false; // Enabled unless explicitly false
  } catch {
    return true; // Default enabled on parse error
  }
}

/**
 * Check if AI features are enabled and show a toast if not.
 * Returns true if AI features are enabled, false otherwise.
 * Use this at AI entry points to gate access and inform the user.
 */
export function checkAiFeaturesEnabled(
  toastHandler:
    | ((opts: {
        message: string;
        title?: string;
        description?: string;
        type?: 'default' | 'info' | 'success' | 'warning' | 'error' | 'loading';
        duration?: number;
        id?: string;
        dedupeKey?: string;
      }) => void)
    | null
    | undefined,
  featureName?: string,
): boolean {
  if (!getAiFeaturesEnabled()) {
    const message = featureName
      ? `${featureName} requires AI features. Enable them in Settings to continue.`
      : 'AI features are disabled. Enable them in Settings to use this feature.';
    toastHandler?.({ message, type: 'info' });
    return false;
  }
  return true;
}

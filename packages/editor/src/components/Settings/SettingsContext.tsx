import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import {
  updateSettings as applyEditorSettingsPatch,
  DEFAULT_EDITOR_SETTINGS,
  type EditorSettings,
  type EditorSettingsPatch,
  loadSettings as loadEditorSettings,
  saveSettings as saveEditorSettings,
} from '../../settings';

export type Settings = EditorSettings;

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'backup'
  | 'shortcuts'
  | 'export'
  | 'performance'
  | 'models'
  | 'collab'
  | 'ai'
  | 'privacy'
  | 'updates'
  | 'about';

export interface SettingsContextValue {
  settings: EditorSettings;
  /**
   * Section-wise patch: `{ render: { preferWebGpu: true } }` updates one field
   * and leaves the rest of `render` intact. `Partial<EditorSettings>` would
   * have demanded a complete `RenderSettingsStore` for that same call and, if
   * satisfied, silently replaced every other field in the section.
   */
  updateSettings: (patch: EditorSettingsPatch) => void;
  updateSection: (section: SettingsSection, values: Record<string, unknown>) => void;
  resetSettings: () => void;
}

const SettingsCtx = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<EditorSettings>(loadEditorSettings);

  const persist = useCallback((next: EditorSettings) => {
    setSettings(next);
    saveEditorSettings(next);
  }, []);

  const updateSettings = useCallback(
    (patch: EditorSettingsPatch) => {
      // Delegate to the store's canonical merge so the dialog and every other
      // caller of `updateSettings` produce the same result for the same patch.
      persist(applyEditorSettingsPatch(patch));
    },
    [persist],
  );

  const updateSection = useCallback(
    (section: SettingsSection, values: Record<string, unknown>) => {
      const current = (settings as unknown as Record<string, unknown>)[section] as
        | Record<string, unknown>
        | undefined;
      if (!current) return;
      persist({
        ...settings,
        [section]: { ...current, ...values },
      } as EditorSettings);
    },
    [settings, persist],
  );

  const resetSettings = useCallback(() => {
    persist({ ...DEFAULT_EDITOR_SETTINGS });
  }, [persist]);

  return (
    <SettingsCtx.Provider value={{ settings, updateSettings, updateSection, resetSettings }}>
      {children}
    </SettingsCtx.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}

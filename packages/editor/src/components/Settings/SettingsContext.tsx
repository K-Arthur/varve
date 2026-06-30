import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { Settings, SettingsSection } from './settings';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

export interface SettingsContextValue {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  updateSection: (section: SettingsSection, values: Record<string, unknown>) => void;
  resetSettings: () => void;
}

const SettingsCtx = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      persist({ ...settings, ...patch });
    },
    [settings, persist],
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
      } as Settings);
    },
    [settings, persist],
  );

  const resetSettings = useCallback(() => {
    persist({ ...DEFAULT_SETTINGS });
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

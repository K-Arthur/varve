export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'backup'
  | 'shortcuts'
  | 'export'
  | 'models'
  | 'collab'
  | 'ai'
  | 'about';
export type SettingsSectionLabel =
  | 'General'
  | 'Appearance'
  | 'Shortcuts'
  | 'Collab'
  | 'AI'
  | 'About';
export type ThemeMode = 'light' | 'dark' | 'high-contrast' | 'system';
export type UnitType = 'px' | 'pt' | 'cm' | 'mm' | 'in';
export type FontSizeUI = 'small' | 'medium' | 'large';

export interface Settings {
  general: {
    language: string;
    units: UnitType;
    canvasBackground: string;
    autosaveInterval: number;
  };
  appearance: {
    theme: ThemeMode;
    fontSizeUI: FontSizeUI;
  };
  collab: {
    displayName: string;
    avatar: string;
    notifyJoinLeave: boolean;
    showLiveCursors: boolean;
  };
  ai: {
    enabled: boolean;
    model: string;
    shareUsageData: boolean;
  };
}

const STORAGE_KEY = 'strata-settings';

export const DEFAULT_SETTINGS: Settings = {
  general: {
    language: 'en',
    units: 'px',
    canvasBackground: '#ffffff',
    autosaveInterval: 5,
  },
  appearance: {
    theme: 'system',
    fontSizeUI: 'medium',
  },
  collab: {
    displayName: '',
    avatar: '',
    notifyJoinLeave: true,
    showLiveCursors: true,
  },
  ai: {
    enabled: false,
    model: 'gpt-4',
    shareUsageData: false,
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      general: { ...DEFAULT_SETTINGS.general, ...parsed.general },
      appearance: { ...DEFAULT_SETTINGS.appearance, ...parsed.appearance },
      collab: { ...DEFAULT_SETTINGS.collab, ...parsed.collab },
      ai: { ...DEFAULT_SETTINGS.ai, ...parsed.ai },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

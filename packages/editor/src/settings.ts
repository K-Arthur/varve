/**
 * Editor settings store — local-first, localStorage-backed.
 *
 * Contains export defaults, appearance preferences, and per-document
 * last-used settings for convenience.
 *
 * Separate from the UI-level Settings (General/Appearance/Collab/AI) to
 * keep the export system config self-contained and importable without
 * React context.
 */

import type { ExportFormat, ExportScale, RenderingIntent } from '@strata/scene';

export interface ExportSettingsStore {
  defaultScale: ExportScale;
  defaultFormat: ExportFormat;
  defaultColorProfile: 'srgb' | 'display-p3';
  defaultDestination: string | null;
  defaultFilenameTemplate: string;
  defaultOutlineText: boolean;
  defaultIccProfile: string;
  defaultBleedMm: number;
  defaultRenderingIntent: RenderingIntent;
  lastUsedPerDocument: Record<string, { destination: string; format: ExportFormat }>;
}

export interface PanelSettingsStore {
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  leftPanelWidth: number | null;
  rightPanelWidth: number | null;
}

export interface AppearanceSettingsStore {
  theme: 'light' | 'dark' | 'high-contrast';
  reduceMotion: boolean;
}

export interface RenderSettingsStore {
  /** Prefer WebGPU compositor when adapter available (Canvas2D fallback on loss). */
  preferWebGpu: boolean;
}

export interface StartupSettingsStore {
  /** Show the branded chromatic-aberration loader on boot. False → instant transition. */
  showBrandedLoader: boolean;
}

export interface EditorSettings {
  export: ExportSettingsStore;
  appearance: AppearanceSettingsStore;
  panel: PanelSettingsStore;
  render: RenderSettingsStore;
  startup: StartupSettingsStore;
}

const STORAGE_KEY = 'strata-editor-settings';

export const DEFAULT_EXPORT_SETTINGS: ExportSettingsStore = {
  defaultScale: { type: 'factor', value: 2 },
  defaultFormat: 'png',
  defaultColorProfile: 'srgb',
  defaultDestination: null,
  defaultFilenameTemplate: '{name}{suffix}.{ext}',
  defaultOutlineText: false,
  defaultIccProfile: 'FOGRA39',
  defaultBleedMm: 3,
  defaultRenderingIntent: 'relative',
  lastUsedPerDocument: {},
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettingsStore = {
  theme: 'light',
  reduceMotion: false,
};

export const DEFAULT_PANEL_SETTINGS: PanelSettingsStore = {
  leftPanelVisible: true,
  rightPanelVisible: true,
  leftPanelWidth: null,
  rightPanelWidth: null,
};

export const DEFAULT_RENDER_SETTINGS: RenderSettingsStore = {
  preferWebGpu: false,
};

export const DEFAULT_STARTUP_SETTINGS: StartupSettingsStore = {
  showBrandedLoader: true,
};

/** Performance budget for the startup/loading experience. */
export const STARTUP_PERFORMANCE_BUDGET = {
  /** Max additional time-to-interactive from branded loader (beyond init) — 50ms */
  maxLoaderOverheadMs: 50,
  /** Target frame rate for chromatic-aberration animation */
  targetFps: 60,
  /** Degradation threshold — switch to static below this */
  minAcceptableFps: 30,
  /** Max total startup time from app_mount to home_ready (budget for init work) */
  maxStartupMs: 1200,
} as const;

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  export: { ...DEFAULT_EXPORT_SETTINGS },
  appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
  panel: { ...DEFAULT_PANEL_SETTINGS },
  render: { ...DEFAULT_RENDER_SETTINGS },
  startup: { ...DEFAULT_STARTUP_SETTINGS },
};

function mergePartial<T extends object>(defaults: T, partial: Partial<T> | undefined): T {
  if (!partial) return { ...defaults };
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const val = partial[key];
    result[key] = val !== undefined ? val : defaults[key];
  }
  return result;
}

export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
      return {
        export: { ...DEFAULT_EXPORT_SETTINGS },
        appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
        panel: { ...DEFAULT_PANEL_SETTINGS },
        render: { ...DEFAULT_RENDER_SETTINGS },
        startup: { ...DEFAULT_STARTUP_SETTINGS },
      };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      export: mergePartial(DEFAULT_EXPORT_SETTINGS, parsed.export as Partial<ExportSettingsStore>),
      appearance: mergePartial(
        DEFAULT_APPEARANCE_SETTINGS,
        parsed.appearance as Partial<AppearanceSettingsStore>,
      ),
      panel: mergePartial(DEFAULT_PANEL_SETTINGS, parsed.panel as Partial<PanelSettingsStore>),
      render: mergePartial(DEFAULT_RENDER_SETTINGS, parsed.render as Partial<RenderSettingsStore>),
      startup: mergePartial(
        DEFAULT_STARTUP_SETTINGS,
        parsed.startup as Partial<StartupSettingsStore>,
      ),
    };
  } catch {
    return {
      export: { ...DEFAULT_EXPORT_SETTINGS },
      appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
      panel: { ...DEFAULT_PANEL_SETTINGS },
      render: { ...DEFAULT_RENDER_SETTINGS },
      startup: { ...DEFAULT_STARTUP_SETTINGS },
    };
  }
}

export function saveSettings(settings: EditorSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export interface EditorSettingsPatch {
  export?: Partial<ExportSettingsStore>;
  appearance?: Partial<AppearanceSettingsStore>;
  panel?: Partial<PanelSettingsStore>;
  render?: Partial<RenderSettingsStore>;
  startup?: Partial<StartupSettingsStore>;
}

export function updateSettings(patch: EditorSettingsPatch): EditorSettings {
  const current = loadSettings();
  const next: EditorSettings = {
    export: { ...current.export, ...patch.export },
    appearance: { ...current.appearance, ...patch.appearance },
    panel: { ...current.panel, ...patch.panel },
    render: { ...current.render, ...patch.render },
    startup: { ...current.startup, ...patch.startup },
  };
  saveSettings(next);
  return next;
}

export function resetSettings(): EditorSettings {
  const defaults: EditorSettings = {
    export: { ...DEFAULT_EXPORT_SETTINGS },
    appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
    panel: { ...DEFAULT_PANEL_SETTINGS },
    render: { ...DEFAULT_RENDER_SETTINGS },
    startup: { ...DEFAULT_STARTUP_SETTINGS },
  };
  saveSettings(defaults);
  return defaults;
}

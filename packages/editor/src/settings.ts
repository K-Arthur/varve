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

import type { ExportFormat, ExportScale, RenderingIntent } from '@varve/scene';
import type { AnalyticsConsentState } from '@varve/shared';
import {
  createDefaultSectionState,
  migrateLegacyDisclosureState,
  migrateSectionState,
  type SectionVisibilityState,
} from './components/Inspector/sectionState';

export type ThemeMode = 'light' | 'dark' | 'high-contrast' | 'system';
export type UnitType = 'px' | 'pt' | 'cm' | 'mm' | 'in';
export type FontSizeUI = 'small' | 'medium' | 'large';

export interface ExportSettingsStore {
  defaultScale: ExportScale;
  defaultFormat: ExportFormat;
  /**
   * Default destination colour space for raster exports. 'srgb' is the
   * portable baseline; wide-gamut choices convert the rendered composite
   * analytically and embed an ICC profile (PNG/JPEG). WebP cannot embed
   * profiles — the choice is disclosed per export, never silently dropped.
   */
  defaultColorProfile: 'srgb' | 'display-p3' | 'adobe-rgb' | 'pro-photo';
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
  /** Logo panel visibility (persisted across sessions). */
  logoPanelVisible: boolean;
}

export interface AppearanceSettingsStore {
  /**
   * Includes `'system'` (follow the OS preference), which the Appearance
   * dialog offers and explains. Keeping this narrower than `ThemeMode` made
   * the dialog's own "Select System to follow OS preference" branch
   * unreachable to the type checker.
   */
  theme: ThemeMode;
  reduceMotion: boolean;
  /** When true, bypasses all workspace-based menu filtering. */
  showAllMenuItems: boolean;
  /** Show shortcut-tip chip in the status bar. */
  showShortcutTips: boolean;
  /** UI font size: 'small' | 'medium' | 'large'. */
  fontSizeUI: 'small' | 'medium' | 'large';
}

export interface RenderSettingsStore {
  /** Prefer WebGPU compositor when adapter available (Canvas2D fallback on loss). */
  preferWebGpu: boolean;
  /** IR cache byte budget preset — see packages/editor/src/canvas/memoryBudget.ts. */
  memoryBudget: 'low' | 'medium' | 'high';
}

export interface PerformanceSettingsStore {
  /** Reduced-motion preference override. 'system' defers to prefers-reduced-motion. */
  reducedMotionOverride: 'system' | 'always' | 'never';
  /**
   * Show the on-canvas performance diagnostics HUD (frame timing, cache
   * stats, render path). Off by default for every install, including dev
   * builds — enable explicitly via Settings > Performance > Diagnostics.
   */
  showPerformanceDiagnostics: boolean;
}

export interface StartupSettingsStore {
  /** Show the branded chromatic-aberration loader on boot. False → instant transition. */
  showBrandedLoader: boolean;
}

/** Application-level viewport/view defaults restored on new sessions and page reload. */
export interface ViewportSettingsStore {
  snapEnabled: boolean;
  pixelGridEnabled: boolean;
  pixelGridSnapEnabled: boolean;
  dotGridEnabled: boolean;
  bleedGuidesVisible: boolean;
  layoutGridVisible: boolean;
  rulerMode: 'global' | 'artboard';
  gridOverlayMode: 'none' | 'document' | 'baseline' | 'isometric';
  unitType: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%';
  guidesVisible: boolean;
  snapGrid: number;
  gridVisible: boolean;
  gridSubdivisions: number;
}

/** Per-section collapse/hidden preferences for the Inspector panel. */
export interface SectionSettingsStore {
  /** Schema version for safe migration. */
  version: number;
  /** Per-section collapsed/hidden state. */
  sections: SectionVisibilityState;
}

export interface LayersSettingsStore {
  autoReveal: boolean;
  marqueeContainment: boolean;
}

export interface GeneralSettingsStore {
  language: string;
  units: 'px' | 'pt' | 'cm' | 'mm' | 'in';
  autosaveInterval: number;
}

export interface CollabSettingsStore {
  displayName: string;
  avatar: string;
  notifyJoinLeave: boolean;
  showLiveCursors: boolean;
}

export interface AiSettingsStore {
  enabled: boolean;
  model: string;
  shareUsageData: boolean;
}

/** Product usage and diagnostics consent. Crash reporting is separate. */
export interface PrivacySettingsStore {
  usageAnalytics: AnalyticsConsentState;
  diagnostics: AnalyticsConsentState;
}

export interface LearningSettingsStore {
  /** Show contextual micro-hints (tool first-use, shortcuts). */
  showContextualTips: boolean;
  /** Show keyboard shortcut hints in tooltips and status bar. */
  showShortcutHints: boolean;
  /** Automatically suggest tutorials when entering new workspaces. */
  autoSuggestTutorials: boolean;
}

export interface EditorSettings {
  general: GeneralSettingsStore;
  export: ExportSettingsStore;
  appearance: AppearanceSettingsStore;
  panel: PanelSettingsStore;
  render: RenderSettingsStore;
  startup: StartupSettingsStore;
  viewport: ViewportSettingsStore;
  sections: SectionSettingsStore;
  performance: PerformanceSettingsStore;
  layers: LayersSettingsStore;
  collab: CollabSettingsStore;
  ai: AiSettingsStore;
  privacy: PrivacySettingsStore;
  learning: LearningSettingsStore;
  features: {
    /** Enable finding navigation (deep-link + inspector section jump). */
    findingsNavigation: boolean;
    /** Show audit findings overlay on canvas by default. */
    findingsOverlay: boolean;
    /** Enable experimental codegen workspace. */
    codegenWorkspace: boolean;
    /** Enable experimental AI features (background removal, upscaling, etc.). */
    aiFeatures: boolean;
    /** Enable reduced motion mode for animations. */
    reducedMotion: boolean;
  };
}

const STORAGE_KEY = 'varve-editor-settings';

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
  showAllMenuItems: false,
  showShortcutTips: true,
  fontSizeUI: 'medium',
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsStore = {
  language: 'en',
  units: 'px',
  autosaveInterval: 5,
};

export const DEFAULT_COLLAB_SETTINGS: CollabSettingsStore = {
  displayName: '',
  avatar: '',
  notifyJoinLeave: true,
  showLiveCursors: true,
};

export const DEFAULT_AI_SETTINGS: AiSettingsStore = {
  enabled: false,
  model: 'gpt-4',
  shareUsageData: false,
};

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettingsStore = {
  usageAnalytics: 'unknown',
  diagnostics: 'unknown',
};

export const DEFAULT_LEARNING_SETTINGS: LearningSettingsStore = {
  showContextualTips: true,
  showShortcutHints: true,
  autoSuggestTutorials: true,
};

export const DEFAULT_PANEL_SETTINGS: PanelSettingsStore = {
  leftPanelVisible: true,
  rightPanelVisible: true,
  leftPanelWidth: null,
  rightPanelWidth: null,
  logoPanelVisible: false,
};

export const DEFAULT_RENDER_SETTINGS: RenderSettingsStore = {
  preferWebGpu: false,
  memoryBudget: 'medium',
};

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettingsStore = {
  reducedMotionOverride: 'system',
  showPerformanceDiagnostics: false,
};

export const DEFAULT_STARTUP_SETTINGS: StartupSettingsStore = {
  showBrandedLoader: true,
};

export const DEFAULT_VIEWPORT_SETTINGS: ViewportSettingsStore = {
  snapEnabled: true,
  pixelGridEnabled: false,
  pixelGridSnapEnabled: false,
  dotGridEnabled: false,
  bleedGuidesVisible: false,
  layoutGridVisible: false,
  rulerMode: 'artboard',
  gridOverlayMode: 'none',
  unitType: 'px',
  guidesVisible: true,
  snapGrid: 8,
  gridVisible: false,
  gridSubdivisions: 4,
};

export const DEFAULT_SECTION_SETTINGS: SectionSettingsStore = {
  version: 1,
  sections: createDefaultSectionState(),
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

export const DEFAULT_LAYERS_SETTINGS: LayersSettingsStore = {
  autoReveal: true,
  marqueeContainment: false,
};

export const DEFAULT_FEATURES = {
  findingsNavigation: false,
  findingsOverlay: false,
  codegenWorkspace: true,
  aiFeatures: true,
  reducedMotion: false,
};

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  general: { ...DEFAULT_GENERAL_SETTINGS },
  export: { ...DEFAULT_EXPORT_SETTINGS },
  appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
  panel: { ...DEFAULT_PANEL_SETTINGS },
  render: { ...DEFAULT_RENDER_SETTINGS },
  startup: { ...DEFAULT_STARTUP_SETTINGS },
  viewport: { ...DEFAULT_VIEWPORT_SETTINGS },
  sections: { ...DEFAULT_SECTION_SETTINGS },
  performance: { ...DEFAULT_PERFORMANCE_SETTINGS },
  layers: { ...DEFAULT_LAYERS_SETTINGS },
  collab: { ...DEFAULT_COLLAB_SETTINGS },
  ai: { ...DEFAULT_AI_SETTINGS },
  privacy: { ...DEFAULT_PRIVACY_SETTINGS },
  learning: { ...DEFAULT_LEARNING_SETTINGS },
  features: { ...DEFAULT_FEATURES },
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

function normalizeAnalyticsConsent(value: unknown): AnalyticsConsentState {
  return value === 'granted' || value === 'denied' ? value : 'unknown';
}

export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('strata-editor-settings');
    if (!raw) {
      // Check for legacy UI-level settings and migrate them
      const uiRaw =
        localStorage.getItem('varve-settings') ?? localStorage.getItem('strata-settings');
      const uiParsed = uiRaw ? (JSON.parse(uiRaw) as Record<string, unknown>) : undefined;
      const result: EditorSettings = {
        general: { ...DEFAULT_GENERAL_SETTINGS },
        export: { ...DEFAULT_EXPORT_SETTINGS },
        appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
        panel: { ...DEFAULT_PANEL_SETTINGS },
        render: { ...DEFAULT_RENDER_SETTINGS },
        startup: { ...DEFAULT_STARTUP_SETTINGS },
        viewport: { ...DEFAULT_VIEWPORT_SETTINGS },
        sections: { ...DEFAULT_SECTION_SETTINGS },
        performance: { ...DEFAULT_PERFORMANCE_SETTINGS },
        layers: { ...DEFAULT_LAYERS_SETTINGS },
        collab: { ...DEFAULT_COLLAB_SETTINGS },
        ai: { ...DEFAULT_AI_SETTINGS },
        privacy: { ...DEFAULT_PRIVACY_SETTINGS },
        features: { ...DEFAULT_FEATURES },
      };
      // Migrate legacy UI settings if present
      if (uiParsed) {
        const gen = uiParsed.general as Record<string, unknown> | undefined;
        if (gen) {
          if (typeof gen.language === 'string') result.general.language = gen.language;
          if (typeof gen.units === 'string')
            result.general.units = gen.units as GeneralSettingsStore['units'];
          if (typeof gen.autosaveInterval === 'number')
            result.general.autosaveInterval = gen.autosaveInterval;
        }
        const app = uiParsed.appearance as Record<string, unknown> | undefined;
        if (app) {
          if (typeof app.theme === 'string')
            result.appearance.theme = app.theme as AppearanceSettingsStore['theme'];
          if (typeof app.fontSizeUI === 'string')
            result.appearance.fontSizeUI = app.fontSizeUI as AppearanceSettingsStore['fontSizeUI'];
        }
        const cl = uiParsed.collab as Record<string, unknown> | undefined;
        if (cl) {
          if (typeof cl.displayName === 'string') result.collab.displayName = cl.displayName;
          if (typeof cl.avatar === 'string') result.collab.avatar = cl.avatar;
          if (typeof cl.notifyJoinLeave === 'boolean')
            result.collab.notifyJoinLeave = cl.notifyJoinLeave;
          if (typeof cl.showLiveCursors === 'boolean')
            result.collab.showLiveCursors = cl.showLiveCursors;
        }
        const ai = uiParsed.ai as Record<string, unknown> | undefined;
        if (ai) {
          if (typeof ai.enabled === 'boolean') result.ai.enabled = ai.enabled;
          if (typeof ai.model === 'string') result.ai.model = ai.model;
          if (typeof ai.shareUsageData === 'boolean') result.ai.shareUsageData = ai.shareUsageData;
        }
      }
      return result;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const exportSettings = mergePartial(
      DEFAULT_EXPORT_SETTINGS,
      parsed.export as Partial<ExportSettingsStore>,
    );
    // Sanitize a persisted colour profile to the supported set; unknown
    // values (or the old Display-P3 choice persisted before encoded parity)
    // fall back to the sRGB baseline.
    if (
      exportSettings.defaultColorProfile !== 'srgb' &&
      exportSettings.defaultColorProfile !== 'display-p3' &&
      exportSettings.defaultColorProfile !== 'adobe-rgb' &&
      exportSettings.defaultColorProfile !== 'pro-photo'
    ) {
      exportSettings.defaultColorProfile = 'srgb';
    }
    // AVIF has no encoder in any backend; a persisted default would make every
    // export throw. Reset to PNG rather than surfacing a broken default.
    if (exportSettings.defaultFormat === 'avif') {
      exportSettings.defaultFormat = 'png';
    }
    const privacy = mergePartial(
      DEFAULT_PRIVACY_SETTINGS,
      parsed.privacy as Partial<PrivacySettingsStore>,
    );
    privacy.usageAnalytics = normalizeAnalyticsConsent(privacy.usageAnalytics);
    privacy.diagnostics = normalizeAnalyticsConsent(privacy.diagnostics);
    return {
      general: mergePartial(
        DEFAULT_GENERAL_SETTINGS,
        parsed.general as Partial<GeneralSettingsStore>,
      ),
      export: exportSettings,
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
      viewport: mergePartial(
        DEFAULT_VIEWPORT_SETTINGS,
        parsed.viewport as Partial<ViewportSettingsStore>,
      ),
      sections: {
        version: 1,
        sections: migrateLegacyDisclosureState(
          migrateSectionState(
            (parsed.sections as Record<string, unknown> | undefined)?.sections as
              | Record<string, unknown>
              | undefined,
          ),
        ),
      },
      performance: mergePartial(
        DEFAULT_PERFORMANCE_SETTINGS,
        parsed.performance as Partial<PerformanceSettingsStore>,
      ),
      layers: mergePartial(DEFAULT_LAYERS_SETTINGS, parsed.layers as Partial<LayersSettingsStore>),
      collab: mergePartial(DEFAULT_COLLAB_SETTINGS, parsed.collab as Partial<CollabSettingsStore>),
      ai: mergePartial(DEFAULT_AI_SETTINGS, parsed.ai as Partial<AiSettingsStore>),
      privacy,
      features: {
        ...DEFAULT_FEATURES,
        ...(parsed.features as Partial<typeof DEFAULT_FEATURES> | undefined),
      },
    };
  } catch {
    return {
      general: { ...DEFAULT_GENERAL_SETTINGS },
      export: { ...DEFAULT_EXPORT_SETTINGS },
      appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
      panel: { ...DEFAULT_PANEL_SETTINGS },
      render: { ...DEFAULT_RENDER_SETTINGS },
      startup: { ...DEFAULT_STARTUP_SETTINGS },
      viewport: { ...DEFAULT_VIEWPORT_SETTINGS },
      sections: { ...DEFAULT_SECTION_SETTINGS },
      performance: { ...DEFAULT_PERFORMANCE_SETTINGS },
      layers: { ...DEFAULT_LAYERS_SETTINGS },
      collab: { ...DEFAULT_COLLAB_SETTINGS },
      ai: { ...DEFAULT_AI_SETTINGS },
      privacy: { ...DEFAULT_PRIVACY_SETTINGS },
      features: { ...DEFAULT_FEATURES },
    };
  }
}

export function saveSettings(settings: EditorSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export interface EditorSettingsPatch {
  general?: Partial<GeneralSettingsStore>;
  export?: Partial<ExportSettingsStore>;
  appearance?: Partial<AppearanceSettingsStore>;
  panel?: Partial<PanelSettingsStore>;
  render?: Partial<RenderSettingsStore>;
  startup?: Partial<StartupSettingsStore>;
  viewport?: Partial<ViewportSettingsStore>;
  sections?: Partial<SectionSettingsStore>;
  performance?: Partial<PerformanceSettingsStore>;
  layers?: Partial<LayersSettingsStore>;
  collab?: Partial<CollabSettingsStore>;
  ai?: Partial<AiSettingsStore>;
  privacy?: Partial<PrivacySettingsStore>;
}

export function updateSettings(patch: EditorSettingsPatch): EditorSettings {
  const current = loadSettings();
  const next: EditorSettings = {
    general: { ...current.general, ...patch.general },
    export: { ...current.export, ...patch.export },
    appearance: { ...current.appearance, ...patch.appearance },
    panel: { ...current.panel, ...patch.panel },
    render: { ...current.render, ...patch.render },
    startup: { ...current.startup, ...patch.startup },
    viewport: { ...current.viewport, ...patch.viewport },
    sections: {
      ...current.sections,
      ...patch.sections,
      sections: patch.sections?.sections ?? current.sections.sections,
    },
    performance: { ...current.performance, ...patch.performance },
    layers: { ...current.layers, ...patch.layers },
    collab: { ...current.collab, ...patch.collab },
    ai: { ...current.ai, ...patch.ai },
    privacy: { ...current.privacy, ...patch.privacy },
    features: { ...current.features },
  };
  saveSettings(next);
  return next;
}

export function resetSettings(): EditorSettings {
  const defaults: EditorSettings = {
    general: { ...DEFAULT_GENERAL_SETTINGS },
    export: { ...DEFAULT_EXPORT_SETTINGS },
    appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
    panel: { ...DEFAULT_PANEL_SETTINGS },
    render: { ...DEFAULT_RENDER_SETTINGS },
    startup: { ...DEFAULT_STARTUP_SETTINGS },
    viewport: { ...DEFAULT_VIEWPORT_SETTINGS },
    sections: { ...DEFAULT_SECTION_SETTINGS },
    performance: { ...DEFAULT_PERFORMANCE_SETTINGS },
    layers: { ...DEFAULT_LAYERS_SETTINGS },
    collab: { ...DEFAULT_COLLAB_SETTINGS },
    ai: { ...DEFAULT_AI_SETTINGS },
    privacy: { ...DEFAULT_PRIVACY_SETTINGS },
    features: { ...DEFAULT_FEATURES },
  };
  saveSettings(defaults);
  return defaults;
}

import type { Platform } from '@varve/platform';
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { isWorkspaceModeAllowed } from '../capabilities/restrictions';
import { loadSettings, updateSettings } from '../settings';
import type { ToolId } from '../tools/types';
import { emitWorkspaceReset } from '../workspace/workspaceResetEvents';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  hydrateWorkspacePreferencesFromPlatform,
  isModeCustomized,
  resetAllPreferences,
  resetModePreferences,
  setPanelOverride,
  updateWorkspacePreferences,
} from '../workspace/workspaceStore';
import {
  getWorkspaceConfig,
  type PanelId,
  resolveWorkspaceTool,
  WORKSPACE_LABELS,
  type WorkspaceConfig,
  type WorkspaceMode,
} from '../workspace/workspaceTypes';
import { applyToolChange } from './ToolContext';
import type { EditorState } from './types';

/**
 * Map a workspace config to the EditorState panel-visibility fields.
 *
 * The panel booleans in state are a projection of the effective config;
 * this helper keeps every switch site applying the same projection.
 */
export function panelVisibilityPatch(config: WorkspaceConfig) {
  return {
    leftPanelVisible: config.panels.layers.visible,
    rightPanelVisible: config.panels.inspector.visible,
    timelinePanelVisible: config.panels.timeline.visible,
    libraryPanelVisible: config.panels.library.visible,
    codegenPanelVisible: config.panels.codegen.visible,
    logoPanelVisible: config.panels.logo.visible,
    historyPanelVisible: config.panels.history.visible,
  };
}

/**
 * Project the config's canvasOverlays defaults onto the state fields that
 * have runtime consumers.
 */
function overlayPatch(config: WorkspaceConfig) {
  const overlays = config.canvasOverlays;
  return {
    guidesVisible: overlays.guides,
    pixelGridEnabled: overlays.pixelGrid,
    dotGridEnabled: overlays.dotGrid,
    bleedGuidesVisible: overlays.bleedGuides,
    layoutGridVisible: overlays.layoutGrid,
    gridOverlayMode: overlays.baselineGrid ? ('baseline' as const) : ('none' as const),
  };
}

/**
 * The panel fields of the global settings store, derived from a config.
 *
 * `settings.panel` seeds the initial EditorState on launch, so it has to
 * track whatever the workspace last applied — otherwise the next session
 * boots into a layout no workspace actually asked for.
 */
function settingsPanelMirror(config: WorkspaceConfig) {
  return {
    leftPanelVisible: config.panels.layers.visible,
    rightPanelVisible: config.panels.inspector.visible,
    logoPanelVisible: config.panels.logo.visible,
  };
}

/**
 * The one place a workspace config is projected onto runtime state.
 *
 * Switch, unsafe-set, and reset all route through here so the projection
 * (panels, overlays, default tool, settings mirror) can never drift between
 * entry points — the drift is what let reset re-apply customized panels.
 */
function applyWorkspaceConfig(
  config: WorkspaceConfig,
  currentTool: ToolId,
  patch: (patch: Partial<EditorState>) => void,
  extra?: Partial<EditorState>,
  toolRef?: MutableRefObject<ToolId>,
): void {
  const targetTool = resolveWorkspaceTool(config, currentTool);
  if (toolRef && targetTool !== currentTool) {
    applyToolChange(targetTool, toolRef, patch);
  }
  const patchObj: Partial<EditorState> & Record<string, unknown> = {
    ...extra,
    ...panelVisibilityPatch(config),
    ...overlayPatch(config),
  };
  patch(patchObj as Partial<EditorState>);
  updateSettings({ panel: settingsPanelMirror(config) });
}

export function useWorkspaceMode(
  state: EditorState,
  patch: (patch: Partial<EditorState>) => void,
  toolRef: MutableRefObject<ToolId>,
  announcerRef: MutableRefObject<{ announce: (message: string) => void } | null>,
  workspaceSwitchInProgressRef: MutableRefObject<boolean>,
  platform?: Platform,
) {
  // Read by the async hydration below, which must not act on a mode the user
  // has since switched away from.
  const latestState = useRef(state);
  latestState.current = state;

  // Write the pre-upgrade global panel mirror through as real overrides. After
  // mount, never during initial-state construction: the store notifies its
  // subscribers on write, and doing that mid-render produces extra renders.
  useEffect(() => {
    migrateLegacyPanelSettings(BOOT_WORKSPACE_MODE);
  }, []);

  // Fold durable preferences (SQLite on desktop, IndexedDB on web) into the
  // session snapshot once. localStorage alone is not enough: on WebKitGTK it
  // has been observed not surviving between launches, which would silently
  // discard every per-workspace customization on the primary Linux target.
  useEffect(() => {
    if (!platform) return;
    let cancelled = false;
    void hydrateWorkspacePreferencesFromPlatform(platform).then((changed) => {
      if (cancelled || !changed) return;
      // The panel booleans were seeded at boot from the pre-hydration
      // snapshot, so re-project the now-current mode's effective config onto
      // them. Read the mode from the ref rather than the closure: the read is
      // async and the user may have switched while it was in flight.
      const mode = latestState.current.workspaceMode;
      patch(panelVisibilityPatch(getEffectiveWorkspaceConfig(mode)));
    });
    return () => {
      cancelled = true;
    };
  }, [platform, patch]);

  const __setWorkspaceModeUnsafe = useCallback(
    (mode: WorkspaceMode) => {
      applyWorkspaceConfig(
        getEffectiveWorkspaceConfig(mode),
        toolRef.current,
        patch,
        {
          workspaceMode: mode,
        },
        toolRef,
      );
      announcerRef.current?.announce(`Switched to ${WORKSPACE_LABELS[mode]} workspace`);
    },
    [state.tool, patch, announcerRef],
  );

  const requestWorkspaceSwitch = useCallback(
    (mode: WorkspaceMode, options?: { force?: boolean }): Promise<boolean> => {
      if (workspaceSwitchInProgressRef.current) return Promise.resolve(false);
      if (mode === state.workspaceMode) return Promise.resolve(false);
      // A deployment may expose only some workspaces. This is the one place
      // every route into a switch converges — tabs, shortcuts, the command
      // palette, deep links, action handlers — so refusing here is enough;
      // hiding the tab alone would leave the other routes open.
      if (!isWorkspaceModeAllowed(mode)) return Promise.resolve(false);
      workspaceSwitchInProgressRef.current = true;
      try {
        if (!options?.force) {
          if (
            state.tool === 'nodeEdit' ||
            state.tool === 'crop' ||
            state.maskPreviewMode !== 'none'
          ) {
            applyToolChange('select', toolRef, patch);
          }
        }
        applyWorkspaceConfig(
          getEffectiveWorkspaceConfig(mode),
          toolRef.current,
          patch,
          {
            workspaceMode: mode,
          },
          toolRef,
        );
        announcerRef.current?.announce(`Switched to ${WORKSPACE_LABELS[mode]} workspace`);
        return Promise.resolve(true);
      } finally {
        workspaceSwitchInProgressRef.current = false;
      }
    },
    [state, patch, toolRef, announcerRef, workspaceSwitchInProgressRef],
  );

  const resetWorkspaceToDefault = useCallback(() => {
    const mode = state.workspaceMode;
    // Clear this mode's saved customizations FIRST. Resolving the effective
    // config before the reset would merge in the very overrides being
    // discarded, so "reset" would re-apply the customized layout instead of
    // the built-in one.
    updateWorkspacePreferences((prefs) => resetModePreferences(prefs, mode));
    // Built-in config, not the effective one: the overrides are gone and the
    // settings mirror is rewritten from the defaults, so the pre-reset panel
    // visibility cannot come back on the next launch either.
    applyWorkspaceConfig(getWorkspaceConfig(mode), toolRef.current, patch, undefined, toolRef);
    emitWorkspaceReset({ kind: 'mode', mode });
    announcerRef.current?.announce(`Reset ${WORKSPACE_LABELS[mode]} workspace to defaults`);
  }, [state.workspaceMode, state.tool, patch, announcerRef]);

  const resetAllWorkspacesToDefaults = useCallback(() => {
    const mode = state.workspaceMode;
    updateWorkspacePreferences(() => resetAllPreferences());
    applyWorkspaceConfig(getWorkspaceConfig(mode), toolRef.current, patch, undefined, toolRef);
    emitWorkspaceReset({ kind: 'all' });
    announcerRef.current?.announce('Reset all workspaces to defaults');
  }, [state.workspaceMode, state.tool, patch, announcerRef]);

  return {
    __setWorkspaceModeUnsafe,
    requestWorkspaceSwitch,
    resetWorkspaceToDefault,
    resetAllWorkspacesToDefaults,
  };
}

/**
 * Record a panel visibility override for the active workspace mode.
 *
 * Called by the panel toggles so user customizations survive restart and
 * are re-applied the next time the mode is entered.
 */
export function recordPanelVisibilityOverride(
  mode: WorkspaceMode,
  panelId: PanelId,
  visible: boolean,
): void {
  updateWorkspacePreferences((prefs) => {
    const current = prefs[mode];
    if (current?.panelOverrides?.[panelId]?.visible === visible) return prefs;
    return setPanelOverride(prefs, mode, panelId, { visible });
  });
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * The workspace the application opens into.
 *
 * Product decision: the workspace is application-global (never per document)
 * and is not carried across launches — every session starts in Design so a
 * document can't silently open into a specialist environment the user left
 * active days ago. See `docs/architecture/workspace-system.md`.
 */
export const BOOT_WORKSPACE_MODE: WorkspaceMode = 'design';

/**
 * The panel visibility a mode's *global* settings mirror implies, but only
 * where it disagrees with that mode's built-in default.
 *
 * A disagreement is the fingerprint of a user edit made before per-workspace
 * overrides existed, when `settings.panel` was the single global source.
 * Equality carries no information, so it is not seeded — that keeps a mirror
 * left behind by some *other* mode from being adopted as this mode's choice.
 */
function legacyPanelEdits(mode: WorkspaceMode): [PanelId, boolean][] {
  if (isModeCustomized(getWorkspacePreferences(), mode)) return [];
  const base = getWorkspaceConfig(mode).panels;
  const legacy = loadSettings().panel;
  const candidates: [PanelId, boolean][] = [
    ['layers', legacy.leftPanelVisible],
    ['inspector', legacy.rightPanelVisible],
    ['logo', legacy.logoPanelVisible],
  ];
  return candidates.filter(([panelId, visible]) => base[panelId].visible !== visible);
}

/**
 * Persist the legacy mirror as real overrides for this mode.
 *
 * Deliberately separate from `initialPanelVisibility`: that runs while the
 * initial EditorState is being constructed, and writing to the preference
 * store there would notify subscribers during render.
 */
export function migrateLegacyPanelSettings(mode: WorkspaceMode = BOOT_WORKSPACE_MODE): void {
  const edits = legacyPanelEdits(mode);
  if (edits.length === 0) return;
  updateWorkspacePreferences((prefs) =>
    edits.reduce(
      (acc, [panelId, visible]) => setPanelOverride(acc, mode, panelId, { visible }),
      prefs,
    ),
  );
}

/**
 * Panel visibility for the initial EditorState.
 *
 * Resolves through the effective config so a per-workspace customization
 * survives a restart — the previous behaviour seeded from the single global
 * `settings.panel` mirror, which meant customizing Print's panels changed the
 * layout the app booted into under Design.
 *
 * Upgrading users have a populated mirror and no overrides yet, so their
 * pre-upgrade layout is folded in here and written through as real overrides
 * by `migrateLegacyPanelSettings` after mount, rather than being silently
 * reset to the built-in default.
 *
 * Pure by contract — this runs during initial-state construction, so it must
 * not touch the preference store or notify its subscribers.
 */
export function initialPanelVisibility(mode: WorkspaceMode = BOOT_WORKSPACE_MODE) {
  const config = getEffectiveWorkspaceConfig(mode);
  const legacy = legacyPanelEdits(mode);
  if (legacy.length === 0) return panelVisibilityPatch(config);
  const panels = { ...config.panels };
  for (const [panelId, visible] of legacy) {
    panels[panelId] = { ...panels[panelId], visible };
  }
  return panelVisibilityPatch({ ...config, panels });
}

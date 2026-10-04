import type { Platform } from '@varve/platform';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tryGetPanelDefinition } from '../panelRegistry';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferenceHydrationState,
  getWorkspacePreferences,
  setDockLayoutOverride,
  subscribeWorkspacePreferences,
  updateWorkspacePreferences,
} from '../workspaceStore';
import type { PanelId, WorkspaceMode } from '../workspaceTypes';
import type {
  DockFloatingGroupPlacement,
  DockSplitPlacement,
  DockTabGroupPlacement,
} from './dockGeometry';
import {
  type DockPanelVisibility,
  type DockRect,
  resolveDockFloatingGroupGeometry,
  resolveDockTreeGeometry,
} from './dockGeometry';
import {
  activateDockTab,
  DEFAULT_DOCK_FLOAT_BOUNDS,
  DOCK_PANEL_CHROME_HEIGHT,
  DOCK_TAB_STRIP_MIN_HEIGHT,
  redockFloatingGroup,
  setFloatingGroupBounds,
  setSplitRatio,
  validateDockLayout,
} from './dockOps';
import {
  beginDockRestoreAttempt,
  createDockRestoreWriterId,
  markDockRestoreSucceeded,
  shouldUseDockRecoveryDefault,
} from './dockRecovery';
import type { DockFloatingGroup } from './dockTypes';
import { completeEditorDockLayout, createDefaultEditorDockLayout } from './editorDockLayout';
import { useDockPanelDrag } from './useDockPanelDrag';
import {
  type FloatGestureHandlers,
  useFloatingGroupInteractions,
} from './useFloatingGroupInteractions';

export interface DockSplitView extends DockSplitPlacement {
  style: CSSProperties;
  orientation: 'horizontal' | 'vertical';
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onBlur: () => void;
}

export interface DockTabGroupView extends DockTabGroupPlacement {
  style: CSSProperties;
}

export interface DockFloatingGroupView extends DockFloatingGroupPlacement {
  style: CSSProperties;
  headerStyle: CSSProperties;
  activeTitle: string;
  normalizedBounds: DockFloatingGroup['normalizedBounds'];
  moveHandlers: FloatGestureHandlers;
  resizeHandlers: FloatGestureHandlers;
  tabGroup?: DockTabGroupView;
  onRedock: () => void;
  onResetLocation: () => void;
}

export interface DockTabPanelA11y {
  labelledBy: string;
  selected: boolean;
}

export interface DockRecoveryNotice {
  message: string;
  canRetrySaved: boolean;
  canRestoreLastKnownGood: boolean;
  onRetrySaved: () => void;
  onRestoreLastKnownGood: () => void;
  onUseDefault: () => void;
}

export function getDockPanelA11yProps(a11y: DockTabPanelA11y | undefined) {
  return {
    'aria-labelledby': a11y?.labelledBy,
    'aria-hidden': a11y && !a11y.selected ? true : undefined,
  };
}

export interface EditorDockGeometry {
  canvasStyle: CSSProperties;
  toolbarStyle: CSSProperties;
  panelStyles: Partial<Record<PanelId, CSSProperties>>;
  tabGroups: DockTabGroupView[];
  floatingGroups: DockFloatingGroupView[];
  splitters: DockSplitView[];
  dockPanelMoveHandles: ReturnType<typeof useDockPanelDrag>['handles'];
  dockPanelDropPreview: ReturnType<typeof useDockPanelDrag>['preview'];
  tabPanelA11y: Partial<Record<PanelId, DockTabPanelA11y>>;
  selectDockTab: (groupNodeId: string, panelInstanceId: string) => void;
  recoveryNotice: DockRecoveryNotice | null;
}

interface DockBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  toolbarHeight: number;
  toolbarAtTop: boolean;
}

interface ActiveSplitResize {
  pointerId: number;
  mode: WorkspaceMode;
  nodeId: string;
  direction: 'row' | 'column';
  startClient: number;
  startRatio: number;
  extent: number;
  minRatio: number;
  maxRatio: number;
}

interface SplitPreview {
  mode: WorkspaceMode;
  nodeId: string;
  ratio: number;
}

const EMPTY_GEOMETRY: EditorDockGeometry = {
  canvasStyle: { gridArea: 'canvas', minWidth: 0, minHeight: 0 },
  toolbarStyle: {},
  panelStyles: {},
  tabGroups: [],
  floatingGroups: [],
  splitters: [],
  dockPanelMoveHandles: [],
  dockPanelDropPreview: null,
  tabPanelA11y: {},
  selectDockTab: () => {},
  recoveryNotice: null,
};

/**
 * Resolve persisted dock intent into shell-relative boxes. Compact viewports
 * keep the existing drawer projection and never modify the saved layout.
 */
export function useEditorDockGeometry(
  mode: WorkspaceMode,
  shellRef: RefObject<HTMLElement | null>,
  visibility: DockPanelVisibility,
  platform?: Platform,
): EditorDockGeometry {
  const [preferences, setPreferences] = useState(getWorkspacePreferences);
  const [retrySavedMode, setRetrySavedMode] = useState<WorkspaceMode | null>(null);
  const [runtimeRecoveryMode, setRuntimeRecoveryMode] = useState<WorkspaceMode | null>(null);
  const [resolvedRecoveryModes, setResolvedRecoveryModes] = useState<ReadonlySet<WorkspaceMode>>(
    () => new Set(),
  );
  const [dockRestoreWriterId] = useState(createDockRestoreWriterId);
  const restoreStartedModes = useRef(new Set<WorkspaceMode>());
  const promotedLayouts = useRef(new Map<WorkspaceMode, string>());
  const modePreference = preferences[mode];
  const lastKnownGood = modePreference?.dockRestore?.lastKnownGood;
  const canRestoreLastKnownGood = Boolean(
    lastKnownGood && JSON.stringify(lastKnownGood) !== JSON.stringify(modePreference?.dockLayout),
  );
  const retrySavedLayout = retrySavedMode === mode;
  const recoveryRequired =
    runtimeRecoveryMode === mode ||
    (!resolvedRecoveryModes.has(mode) &&
      (Boolean(modePreference?.unreadableDockLayout) ||
        shouldUseDockRecoveryDefault(modePreference?.dockRestore)));
  const [bounds, setBounds] = useState<DockBounds | null>(null);
  const [splitPreview, setSplitPreview] = useState<SplitPreview | null>(null);
  const activeSplitResize = useRef<ActiveSplitResize | null>(null);
  const measureRef = useRef<() => void>(() => {});
  const visibilityEntries = Object.entries(visibility) as Array<[PanelId, boolean]>;
  const visibilityKey = visibilityEntries
    .map(([panel, visible]) => `${panel}:${visible === true ? 1 : 0}`)
    .join('|');
  const stableVisibility = useMemo(
    () =>
      Object.fromEntries(
        visibilityKey
          .split('|')
          .filter(Boolean)
          .map((entry) => {
            const separator = entry.lastIndexOf(':');
            return [entry.slice(0, separator), entry.slice(separator + 1) === '1'];
          }),
      ) as DockPanelVisibility,
    [visibilityKey],
  );
  useEffect(() => {
    const sync = () => setPreferences({ ...getWorkspacePreferences() });
    const unsubscribe = subscribeWorkspacePreferences(sync);
    sync();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const toolbar = shell.querySelector<HTMLElement>('.floating-toolbar');
    const measure = () => {
      const shellRect = shell.getBoundingClientRect();
      const compact = window.matchMedia?.('(max-width: 899px)').matches ?? window.innerWidth <= 899;
      if (compact || shellRect.width <= 0 || shellRect.height <= 0) {
        setBounds((previous) => (previous === null ? previous : null));
        return;
      }
      // Where the dock area begins: the shell grid's `canvas` row.
      //
      // This was read from `.editor-canvas`'s own top edge. The canvas lives
      // *inside* the dock this hook positions, so once the dock stopped being a
      // flush single-cell wrapper around it (the selection-path row now sits
      // above the canvas) that reference became a feedback loop: it returned
      // the dock's current output plus the rows above the canvas, so each
      // measurement pass moved the dock — and every panel placed from these
      // bounds — further down, opening a growing empty band between the tab
      // strip and the panels. Computed track sizes are actual layout (not the
      // `--menubar-total-height` token arithmetic that has drifted before) and
      // cannot be influenced by where the dock currently sits.
      const gridRows = getComputedStyle(shell).gridTemplateRows.trim().split(/\s+/);
      const rowHeight = (index: number) => {
        const parsed = Number.parseFloat(gridRows[index] ?? '');
        return Number.isFinite(parsed) ? parsed : 0;
      };
      // Rows 0 and 1 are the menubar row (application menu + context bar) and
      // the tab strip; row 2 is `canvas`. Focus mode collapses the template to
      // a single `canvas` row, where the dock starts at the shell's top edge.
      const top = gridRows.length >= 2 ? rowHeight(0) + rowHeight(1) : 0;
      // Only fixed shell chrome may bound the dock. Page Navigator is itself
      // positioned by this hook: using its output top as the next input height
      // alternated between the desktop dock and its minimum-size fallback,
      // continually moving publishing tabs and preventing pointer input.
      const bottomCandidates = [
        shell.querySelector<HTMLElement>('.selection-info-bar'),
        shell.querySelector<HTMLElement>('.editor-status'),
      ]
        .map((element) => element?.getBoundingClientRect().top)
        .filter((value): value is number => value !== undefined && value > shellRect.top);
      const bottom =
        bottomCandidates.length > 0
          ? Math.min(...bottomCandidates) - shellRect.top
          : shellRect.height;
      const next = {
        left: 0,
        top,
        width: shellRect.width,
        height: Math.max(0, bottom - top),
        toolbarHeight: toolbar?.getBoundingClientRect().height ?? 0,
        toolbarAtTop: toolbar?.dataset.placement === 'top',
      };
      setBounds((previous) => {
        if (
          previous &&
          Math.abs(previous.top - next.top) < 0.5 &&
          Math.abs(previous.width - next.width) < 0.5 &&
          Math.abs(previous.height - next.height) < 0.5 &&
          Math.abs(previous.toolbarHeight - next.toolbarHeight) < 0.5 &&
          previous.toolbarAtTop === next.toolbarAtTop
        ) {
          return previous;
        }
        return next;
      });
    };
    measureRef.current = measure;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(shell);
    for (const element of shell.querySelectorAll<HTMLElement>(
      '.editor-shell__menubar, .editor-menubar, .editor-status, .selection-info-bar, .page-nav-container, .floating-toolbar',
    )) {
      observer?.observe(element);
    }
    // The toolbar placement is a workspace preference reflected on a data
    // attribute. Moving from bottom to top does not change its border-box
    // size, so ResizeObserver alone never refreshes the inline dock position.
    const toolbarPlacementObserver =
      toolbar && typeof MutationObserver !== 'undefined' ? new MutationObserver(measure) : null;
    if (toolbar) {
      toolbarPlacementObserver?.observe(toolbar, {
        attributes: true,
        attributeFilter: ['data-placement'],
      });
    }
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      toolbarPlacementObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [shellRef]);

  useLayoutEffect(() => {
    measureRef.current();
  }, [mode, visibilityKey]);

  const dockLayout = useMemo(() => {
    const modeConfig = getEffectiveWorkspaceConfig(mode, preferences);
    const saved =
      recoveryRequired && !retrySavedLayout
        ? createDefaultEditorDockLayout(mode)
        : (preferences[mode]?.dockLayout ?? createDefaultEditorDockLayout(mode));
    const additionalPanels = Object.entries(stableVisibility)
      .filter(([, visible]) => visible === true)
      .map(([panelId]) => panelId as PanelId);
    return completeEditorDockLayout(
      saved,
      mode,
      modeConfig.panels.timeline.visible,
      modeConfig.panels.emailPreview.visible,
      additionalPanels,
    );
  }, [mode, preferences, recoveryRequired, retrySavedLayout, stableVisibility]);
  const preferencesReady = !platform || getWorkspacePreferenceHydrationState() === 'settled';

  const selectDockTab = useCallback(
    (groupNodeId: string, panelInstanceId: string) => {
      updateWorkspacePreferences((current) => {
        const savedLayout = current[mode]?.dockLayout ?? dockLayout;
        const primaryIndex = savedLayout.windows.findIndex((window) => window.role === 'primary');
        if (primaryIndex < 0) return current;
        const primary = savedLayout.windows[primaryIndex]!;
        const floatingGroup = primary.floatingGroups?.find((group) => group.id === groupNodeId);
        if (floatingGroup?.panels.some((panel) => panel.instanceId === panelInstanceId)) {
          const windows = savedLayout.windows.map((window, index) =>
            index === primaryIndex
              ? {
                  ...window,
                  floatingGroups: (window.floatingGroups ?? []).map((group) =>
                    group.id === groupNodeId
                      ? { ...group, activePanelInstanceId: panelInstanceId }
                      : group,
                  ),
                }
              : window,
          );
          return setDockLayoutOverride(current, mode, { ...savedLayout, windows });
        }
        const nextRoot = activateDockTab(primary.dockRoot, groupNodeId, panelInstanceId);
        if (nextRoot === primary.dockRoot) return current;
        const windows = savedLayout.windows.map((window, index) =>
          index === primaryIndex ? { ...window, dockRoot: nextRoot } : window,
        );
        return setDockLayoutOverride(current, mode, { ...savedLayout, windows });
      });
    },
    [dockLayout, mode],
  );

  const onRetrySaved = useCallback(() => {
    restoreStartedModes.current.add(mode);
    setResolvedRecoveryModes((previous) => new Set(previous).add(mode));
    promotedLayouts.current.delete(mode);
    setRuntimeRecoveryMode(null);
    setRetrySavedMode(mode);
    updateWorkspacePreferences((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        dockRestore: beginDockRestoreAttempt(current[mode]?.dockRestore, dockRestoreWriterId),
      },
    }));
  }, [dockRestoreWriterId, mode]);

  const onRestoreLastKnownGood = useCallback(() => {
    const recoverableLayout = preferences[mode]?.dockRestore?.lastKnownGood;
    if (!recoverableLayout) return;
    restoreStartedModes.current.add(mode);
    setResolvedRecoveryModes((previous) => new Set(previous).add(mode));
    promotedLayouts.current.delete(mode);
    setRuntimeRecoveryMode(null);
    setRetrySavedMode(mode);
    updateWorkspacePreferences((current) => {
      const restored = setDockLayoutOverride(current, mode, recoverableLayout);
      return {
        ...restored,
        [mode]: {
          ...restored[mode],
          dockRestore: beginDockRestoreAttempt(current[mode]?.dockRestore, dockRestoreWriterId),
        },
      };
    });
  }, [dockRestoreWriterId, mode, preferences]);

  const onUseDefault = useCallback(() => {
    const defaultLayout = createDefaultEditorDockLayout(mode);
    restoreStartedModes.current.add(mode);
    setResolvedRecoveryModes((previous) => new Set(previous).add(mode));
    promotedLayouts.current.delete(mode);
    setRuntimeRecoveryMode(null);
    setRetrySavedMode(null);
    updateWorkspacePreferences((current) => {
      const withDefault = setDockLayoutOverride(current, mode, defaultLayout);
      return {
        ...withDefault,
        [mode]: {
          ...withDefault[mode],
          dockRestore: beginDockRestoreAttempt(current[mode]?.dockRestore, dockRestoreWriterId),
        },
      };
    });
  }, [dockRestoreWriterId, mode]);

  useLayoutEffect(() => {
    if (
      !preferencesReady ||
      recoveryRequired ||
      retrySavedLayout ||
      restoreStartedModes.current.has(mode)
    )
      return;
    restoreStartedModes.current.add(mode);
    updateWorkspacePreferences((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        dockRestore: beginDockRestoreAttempt(current[mode]?.dockRestore, dockRestoreWriterId),
      },
    }));
  }, [dockRestoreWriterId, mode, preferencesReady, recoveryRequired, retrySavedLayout]);

  const recoveryNotice: DockRecoveryNotice | null = recoveryRequired
    ? {
        message: modePreference?.unreadableDockLayout
          ? 'The saved workspace layout cannot be read by this version. It has been kept for recovery.'
          : runtimeRecoveryMode === mode
            ? 'The workspace panels did not finish mounting. A safe default is shown while you choose what to do.'
            : 'The saved workspace layout failed to restore twice. A safe default is shown while you choose what to do.',
        canRetrySaved: Boolean(modePreference?.dockLayout) && !modePreference?.unreadableDockLayout,
        canRestoreLastKnownGood,
        onRetrySaved,
        onRestoreLastKnownGood,
        onUseDefault,
      }
    : null;

  useEffect(() => {
    if (!preferencesReady || !restoreStartedModes.current.has(mode) || recoveryRequired) {
      return;
    }
    const shell = shellRef.current;
    if (!shell) return;
    if (validateDockLayout(dockLayout).length > 0) {
      setResolvedRecoveryModes((previous) => {
        const next = new Set(previous);
        next.delete(mode);
        return next;
      });
      setRetrySavedMode(null);
      setRuntimeRecoveryMode(mode);
      return;
    }
    const primary = dockLayout.windows.find((window) => window.role === 'primary');
    if (!primary) {
      setResolvedRecoveryModes((previous) => {
        const next = new Set(previous);
        next.delete(mode);
        return next;
      });
      setRetrySavedMode(null);
      setRuntimeRecoveryMode(mode);
      return;
    }
    const mountedPanelIds = new Set(
      [...shell.querySelectorAll<HTMLElement>('[data-panel]')].map((element) =>
        element.getAttribute('data-panel'),
      ),
    );
    const activePanelIds = resolveDockTreeGeometry(primary.dockRoot, 1, 1, stableVisibility)
      .panels.filter((panel) => panel.active)
      .map((panel) => panel.panelTypeId);
    for (const group of primary.floatingGroups ?? []) {
      const active =
        group.panels.find((panel) => panel.instanceId === group.activePanelInstanceId) ??
        group.panels[0];
      if (active && stableVisibility[active.panelTypeId] !== false) {
        activePanelIds.push(active.panelTypeId);
      }
    }
    if (activePanelIds.some((panelId) => !mountedPanelIds.has(panelId))) {
      setResolvedRecoveryModes((previous) => {
        const next = new Set(previous);
        next.delete(mode);
        return next;
      });
      setRetrySavedMode(null);
      setRuntimeRecoveryMode(mode);
      return;
    }
    const signature = JSON.stringify(dockLayout);
    if (promotedLayouts.current.get(mode) === signature) return;
    promotedLayouts.current.set(mode, signature);
    updateWorkspacePreferences((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        dockRestore: markDockRestoreSucceeded(
          current[mode]?.dockRestore,
          dockLayout,
          dockRestoreWriterId,
        ),
      },
    }));
    if (retrySavedMode === mode) setRetrySavedMode(null);
  }, [
    dockLayout,
    dockRestoreWriterId,
    mode,
    preferencesReady,
    recoveryRequired,
    retrySavedMode,
    shellRef,
    stableVisibility,
  ]);

  const persistSplitRatio = useCallback(
    (targetMode: WorkspaceMode, nodeId: string, ratio: number) => {
      updateWorkspacePreferences((current) => {
        const savedLayout =
          current[targetMode]?.dockLayout ??
          (targetMode === mode ? dockLayout : createDefaultEditorDockLayout(targetMode));
        const primaryIndex = savedLayout.windows.findIndex((window) => window.role === 'primary');
        if (primaryIndex < 0) return current;
        const primary = savedLayout.windows[primaryIndex]!;
        const nextRoot = setSplitRatio(primary.dockRoot, nodeId, ratio);
        if (nextRoot === primary.dockRoot) return current;
        const windows = savedLayout.windows.map((window, index) =>
          index === primaryIndex ? { ...window, dockRoot: nextRoot } : window,
        );
        return setDockLayoutOverride(current, targetMode, { ...savedLayout, windows });
      });
    },
    [dockLayout, mode],
  );

  const persistFloatBounds = useCallback(
    (
      targetMode: WorkspaceMode,
      groupId: string,
      normalizedBounds: { x: number; y: number; width: number; height: number },
    ) => {
      updateWorkspacePreferences((current) => {
        const savedLayout =
          current[targetMode]?.dockLayout ??
          (targetMode === mode ? dockLayout : createDefaultEditorDockLayout(targetMode));
        const result = setFloatingGroupBounds(savedLayout, groupId, normalizedBounds);
        return result.ok ? setDockLayoutOverride(current, targetMode, result.layout) : current;
      });
    },
    [dockLayout, mode],
  );

  const persistRedock = useCallback(
    (targetMode: WorkspaceMode, groupId: string) => {
      updateWorkspacePreferences((current) => {
        const savedLayout =
          current[targetMode]?.dockLayout ??
          (targetMode === mode ? dockLayout : createDefaultEditorDockLayout(targetMode));
        const result = redockFloatingGroup(savedLayout, groupId);
        return result.ok ? setDockLayoutOverride(current, targetMode, result.layout) : current;
      });
    },
    [dockLayout, mode],
  );

  const floatInteractions = useFloatingGroupInteractions(
    mode,
    bounds ? { width: bounds.width, height: bounds.height } : null,
    persistFloatBounds,
  );
  const dockPanelMove = useDockPanelDrag(
    mode,
    shellRef.current,
    dockLayout,
    bounds,
    stableVisibility,
  );

  const cancelSplitResize = useCallback(() => {
    activeSplitResize.current = null;
    setSplitPreview(null);
  }, []);

  useEffect(() => {
    cancelSplitResize();
  }, [cancelSplitResize, mode]);

  const pointerRatio = useCallback(
    (active: ActiveSplitResize, clientX: number, clientY: number) => {
      const coordinate = active.direction === 'row' ? clientX : clientY;
      const delta = coordinate - active.startClient;
      return Math.min(
        active.maxRatio,
        Math.max(active.minRatio, active.startRatio + delta / active.extent),
      );
    },
    [],
  );

  const commitSplitResize = useCallback(
    (active: ActiveSplitResize, ratio: number) => {
      activeSplitResize.current = null;
      setSplitPreview(null);
      if (Math.abs(active.startRatio - ratio) >= 0.0005) {
        persistSplitRatio(active.mode, active.nodeId, ratio);
      }
    },
    [persistSplitRatio],
  );

  return useMemo(() => {
    if (!bounds) return { ...EMPTY_GEOMETRY, selectDockTab, recoveryNotice };
    const primary = dockLayout.windows.find((window) => window.role === 'primary');
    if (!primary) return { ...EMPTY_GEOMETRY, selectDockTab, recoveryNotice };
    const geometryRoot =
      splitPreview?.mode === mode
        ? setSplitRatio(primary.dockRoot, splitPreview.nodeId, splitPreview.ratio)
        : primary.dockRoot;
    const geometry = resolveDockTreeGeometry(
      geometryRoot,
      bounds.width,
      bounds.height,
      stableVisibility,
    );
    const runtimeFloatingGroups = (primary.floatingGroups ?? []).map((group) => ({
      ...group,
      normalizedBounds: floatInteractions.boundsFor(group.id, group.normalizedBounds),
    }));
    const floatPlacements = runtimeFloatingGroups
      .map((group) =>
        resolveDockFloatingGroupGeometry(group, bounds.width, bounds.height, stableVisibility),
      )
      .filter((group) => group.panels.length > 0);
    const minimumWidth = Math.max(
      geometry.minimumSize.width,
      ...floatPlacements.map((group) => group.minimumSize.width),
    );
    const minimumHeight = Math.max(
      geometry.minimumSize.height,
      ...floatPlacements.map((group) => group.minimumSize.height),
    );
    if (minimumWidth > bounds.width || minimumHeight > bounds.height) {
      // The fixed-slot shell supplies the existing drawer projection when
      // this viewport cannot satisfy the registry's desktop minimums.
      return { ...EMPTY_GEOMETRY, selectDockTab, recoveryNotice };
    }
    const toStyle = (rect: DockRect): CSSProperties => ({
      position: 'absolute',
      left: bounds.left + rect.x,
      top: bounds.top + rect.y,
      width: rect.width,
      height: rect.height,
      minWidth: 0,
      minHeight: 0,
      boxSizing: 'border-box',
      gridArea: 'auto',
    });
    const panelStyles: EditorDockGeometry['panelStyles'] = {};
    for (const placement of geometry.panels) {
      const panelRect = {
        ...placement.rect,
        y: placement.rect.y + DOCK_PANEL_CHROME_HEIGHT,
        height: Math.max(0, placement.rect.height - DOCK_PANEL_CHROME_HEIGHT),
      };
      panelStyles[placement.panelTypeId] = {
        ...toStyle(panelRect),
        ...(placement.active ? {} : { visibility: 'hidden', pointerEvents: 'none' }),
      };
    }
    for (const floating of floatPlacements) {
      for (const placement of floating.panels) {
        panelStyles[placement.panelTypeId] = {
          ...toStyle(placement.rect),
          zIndex: 'calc(var(--z-overlay) + 1)',
          ...(placement.active ? {} : { visibility: 'hidden', pointerEvents: 'none' }),
        };
      }
    }
    const tabGroups: DockTabGroupView[] = [
      ...geometry.tabGroups,
      ...floatPlacements.flatMap((group) => (group.tabGroup ? [group.tabGroup] : [])),
    ].map((group) => ({
      ...group,
      style: {
        ...toStyle(group.rect),
        height: DOCK_TAB_STRIP_MIN_HEIGHT,
        // Keep the panel move grip in its own hit area, clear of tabs and panel controls.
        ...(group.floating ? {} : { paddingRight: 56 }),
        zIndex: group.floating ? 'calc(var(--z-overlay) + 2)' : 'var(--z-overlay)',
      },
    }));
    const floatingGroups: DockFloatingGroupView[] = floatPlacements.map((group) => {
      const tabGroup = tabGroups.find((candidate) => candidate.nodeId === group.id);
      const activeTitle = group.activePanelTypeId
        ? (tryGetPanelDefinition(group.activePanelTypeId)?.title ?? group.activePanelTypeId)
        : 'Panel';
      const normalizedBounds =
        runtimeFloatingGroups.find((candidate) => candidate.id === group.id)?.normalizedBounds ??
        DEFAULT_DOCK_FLOAT_BOUNDS;
      return {
        ...group,
        normalizedBounds,
        style: {
          ...toStyle(group.rect),
          zIndex: 'calc(var(--z-overlay) + 1)',
          pointerEvents: 'none',
        },
        headerStyle: {
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: group.headerRect.height,
          zIndex: 'calc(var(--z-overlay) + 2)',
        },
        activeTitle,
        tabGroup,
        moveHandlers: floatInteractions.gestureHandlers(
          group.id,
          normalizedBounds,
          group.minimumSize,
          'move',
        ),
        resizeHandlers: floatInteractions.gestureHandlers(
          group.id,
          normalizedBounds,
          group.minimumSize,
          'resize',
        ),
        onRedock: () => persistRedock(mode, group.id),
        onResetLocation: () => persistFloatBounds(mode, group.id, { ...DEFAULT_DOCK_FLOAT_BOUNDS }),
      };
    });
    const splitters: DockSplitView[] = geometry.splitters.map((splitter) => ({
      ...splitter,
      orientation: splitter.direction === 'row' ? 'vertical' : 'horizontal',
      style: {
        ...toStyle(splitter.rect),
        zIndex: 'var(--z-overlay)',
      },
      onPointerDown: (event) => {
        if (event.button !== 0 || splitter.extent <= 0) return;
        event.preventDefault();
        const coordinate = splitter.direction === 'row' ? event.clientX : event.clientY;
        activeSplitResize.current = {
          pointerId: event.pointerId,
          mode,
          nodeId: splitter.nodeId,
          direction: splitter.direction,
          startClient: coordinate,
          startRatio: splitter.ratio,
          extent: splitter.extent,
          minRatio: splitter.minRatio,
          maxRatio: splitter.maxRatio,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const active = activeSplitResize.current;
        if (!active || active.pointerId !== event.pointerId) return;
        setSplitPreview({
          mode: active.mode,
          nodeId: active.nodeId,
          ratio: pointerRatio(active, event.clientX, event.clientY),
        });
      },
      onPointerUp: (event) => {
        const active = activeSplitResize.current;
        if (!active || active.pointerId !== event.pointerId) return;
        commitSplitResize(active, pointerRatio(active, event.clientX, event.clientY));
      },
      onPointerCancel: cancelSplitResize,
      onLostPointerCapture: cancelSplitResize,
      onBlur: cancelSplitResize,
      onKeyDown: (event) => {
        if (event.key === 'Escape') {
          if (activeSplitResize.current?.nodeId === splitter.nodeId) {
            event.preventDefault();
            cancelSplitResize();
          }
          return;
        }
        let nextRatio: number | null = null;
        if (splitter.direction === 'row' && event.key === 'ArrowLeft') {
          nextRatio = splitter.ratio - 0.02;
        } else if (splitter.direction === 'row' && event.key === 'ArrowRight') {
          nextRatio = splitter.ratio + 0.02;
        } else if (splitter.direction === 'column' && event.key === 'ArrowUp') {
          nextRatio = splitter.ratio - 0.02;
        } else if (splitter.direction === 'column' && event.key === 'ArrowDown') {
          nextRatio = splitter.ratio + 0.02;
        } else if (event.key === 'Home') {
          nextRatio = splitter.minRatio;
        } else if (event.key === 'End') {
          nextRatio = splitter.maxRatio;
        }
        if (nextRatio === null) return;
        event.preventDefault();
        persistSplitRatio(
          mode,
          splitter.nodeId,
          Math.min(splitter.maxRatio, Math.max(splitter.minRatio, nextRatio)),
        );
      },
    }));
    const tabPanelA11y: EditorDockGeometry['tabPanelA11y'] = {};
    for (const group of geometry.tabGroups) {
      for (const panel of group.panels) {
        tabPanelA11y[panel.panelTypeId] = {
          labelledBy: `dock-tab-${group.nodeId}-${panel.instanceId}`,
          selected: group.activePanelInstanceId === panel.instanceId,
        };
      }
    }
    for (const group of floatPlacements) {
      if (!group.tabGroup) continue;
      for (const panel of group.panels) {
        tabPanelA11y[panel.panelTypeId] = {
          labelledBy: `dock-tab-${group.id}-${panel.panelInstanceId}`,
          selected: panel.active,
        };
      }
    }
    const canvasBox = geometry.canvas;
    const canvasBottom = bounds.top + (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0);
    const toolbarTop = bounds.top + (canvasBox?.y ?? 0);
    // The canvas grid area begins before the selection-path row. Keep the
    // top palette below that content-driven row, including enlarged text.
    const verticalPosition = bounds.toolbarAtTop
      ? `calc(${toolbarTop}px + var(--selection-path-height, 0px) + var(--space-3))`
      : `calc(${canvasBottom}px - var(--space-3) - ${bounds.toolbarHeight}px)`;
    const toolbarStyle: CSSProperties = canvasBox
      ? {
          position: 'absolute',
          left: bounds.left + canvasBox.x + canvasBox.width / 2,
          top: verticalPosition,
          right: 'auto',
          bottom: 'auto',
          width: 'max-content',
          maxWidth: Math.max(0, canvasBox.width - 16),
          transform: 'translateX(-50%)',
          gridArea: 'auto',
        }
      : {};
    return {
      canvasStyle: geometry.canvas
        ? toStyle(geometry.canvas)
        : { gridArea: 'canvas', minWidth: 0, minHeight: 0 },
      toolbarStyle,
      panelStyles,
      tabGroups,
      floatingGroups,
      splitters,
      dockPanelMoveHandles: dockPanelMove.handles,
      dockPanelDropPreview: dockPanelMove.preview,
      tabPanelA11y,
      selectDockTab,
      recoveryNotice,
    };
  }, [
    bounds,
    cancelSplitResize,
    commitSplitResize,
    dockLayout,
    dockPanelMove.handles,
    dockPanelMove.preview,
    mode,
    persistSplitRatio,
    persistFloatBounds,
    persistRedock,
    floatInteractions,
    pointerRatio,
    recoveryNotice,
    selectDockTab,
    splitPreview,
    stableVisibility,
  ]);
}

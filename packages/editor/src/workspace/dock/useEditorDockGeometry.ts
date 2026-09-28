import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  setDockLayoutOverride,
  subscribeWorkspacePreferences,
  updateWorkspacePreferences,
} from '../workspaceStore';
import type { PanelId, WorkspaceMode } from '../workspaceTypes';
import type { DockSplitPlacement, DockTabGroupPlacement } from './dockGeometry';
import { type DockPanelVisibility, type DockRect, resolveDockTreeGeometry } from './dockGeometry';
import { activateDockTab, DOCK_TAB_STRIP_MIN_HEIGHT, setSplitRatio } from './dockOps';
import { completeEditorDockLayout, createDefaultEditorDockLayout } from './editorDockLayout';

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

export interface DockTabPanelA11y {
  labelledBy: string;
  selected: boolean;
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
  splitters: DockSplitView[];
  tabPanelA11y: Partial<Record<PanelId, DockTabPanelA11y>>;
  selectDockTab: (groupNodeId: string, panelInstanceId: string) => void;
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
  splitters: [],
  tabPanelA11y: {},
  selectDockTab: () => {},
};

/**
 * Resolve persisted dock intent into shell-relative boxes. Compact viewports
 * keep the existing drawer projection and never modify the saved layout.
 */
export function useEditorDockGeometry(
  mode: WorkspaceMode,
  shellRef: RefObject<HTMLElement | null>,
  visibility: DockPanelVisibility,
): EditorDockGeometry {
  const [preferences, setPreferences] = useState(getWorkspacePreferences);
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
  useEffect(
    () => subscribeWorkspacePreferences(() => setPreferences(getWorkspacePreferences())),
    [],
  );

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      const shellRect = shell.getBoundingClientRect();
      const compact = window.matchMedia?.('(max-width: 899px)').matches ?? window.innerWidth <= 899;
      if (compact || shellRect.width <= 0 || shellRect.height <= 0) {
        setBounds((previous) => (previous === null ? previous : null));
        return;
      }
      const canvas = shell.querySelector<HTMLElement>('.editor-canvas');
      const toolbar = shell.querySelector<HTMLElement>('.floating-toolbar');
      const top = canvas ? canvas.getBoundingClientRect().top - shellRect.top : 0;
      const bottomCandidates = [
        shell.querySelector<HTMLElement>('.page-nav-container'),
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
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [shellRef]);

  useLayoutEffect(() => {
    measureRef.current();
  }, [mode, visibilityKey]);

  const dockLayout = useMemo(() => {
    const modeConfig = getEffectiveWorkspaceConfig(mode, preferences);
    const saved = preferences[mode]?.dockLayout ?? createDefaultEditorDockLayout(mode);
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
  }, [mode, preferences, stableVisibility]);

  const selectDockTab = useCallback(
    (groupNodeId: string, panelInstanceId: string) => {
      updateWorkspacePreferences((current) => {
        const savedLayout = current[mode]?.dockLayout ?? dockLayout;
        const primaryIndex = savedLayout.windows.findIndex((window) => window.role === 'primary');
        if (primaryIndex < 0) return current;
        const primary = savedLayout.windows[primaryIndex]!;
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
    if (!bounds) return { ...EMPTY_GEOMETRY, selectDockTab };
    const primary = dockLayout.windows.find((window) => window.role === 'primary');
    if (!primary) return { ...EMPTY_GEOMETRY, selectDockTab };
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
    if (geometry.minimumSize.width > bounds.width || geometry.minimumSize.height > bounds.height) {
      // The fixed-slot shell supplies the existing drawer projection when
      // this viewport cannot satisfy the registry's desktop minimums.
      return { ...EMPTY_GEOMETRY, selectDockTab };
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
      const panelRect = placement.tabGroupNodeId
        ? {
            ...placement.rect,
            y: placement.rect.y + DOCK_TAB_STRIP_MIN_HEIGHT,
            height: Math.max(0, placement.rect.height - DOCK_TAB_STRIP_MIN_HEIGHT),
          }
        : placement.rect;
      panelStyles[placement.panelTypeId] = {
        ...toStyle(panelRect),
        ...(placement.active ? {} : { visibility: 'hidden', pointerEvents: 'none' }),
      };
    }
    const tabGroups: DockTabGroupView[] = geometry.tabGroups.map((group) => ({
      ...group,
      style: {
        ...toStyle(group.rect),
        height: DOCK_TAB_STRIP_MIN_HEIGHT,
        zIndex: 'var(--z-overlay)',
      },
    }));
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
    const canvasBox = geometry.canvas;
    const canvasBottom = bounds.top + (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0);
    const toolbarTop = bounds.top + (canvasBox?.y ?? 0);
    const verticalPosition = bounds.toolbarAtTop
      ? `calc(${toolbarTop}px + var(--space-3))`
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
      splitters,
      tabPanelA11y,
      selectDockTab,
    };
  }, [
    bounds,
    cancelSplitResize,
    commitSplitResize,
    dockLayout,
    mode,
    persistSplitRatio,
    pointerRatio,
    selectDockTab,
    splitPreview,
    stableVisibility,
  ]);
}

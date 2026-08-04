/**
 * WorkspaceTabs — responsive workspace switcher for the menubar.
 *
 * Renders the workspace modes in data-driven priority order
 * (WORKSPACE_OVERFLOW_ORDER / WORKSPACE_OVERFLOW_PRIORITY) and relegates the
 * modes that don't fit into a "More" overflow menu. The active mode is
 * always visible (computeWorkspaceLayout evicts a lower-priority tab if
 * needed). Every mode stays reachable via the overflow menu, keyboard
 * shortcuts, and the command palette at every width.
 *
 * Measurement: natural tab widths are captured on mount (all tabs visible)
 * and refreshed for visible tabs as the strip resizes; hidden tabs reuse
 * their cached natural width, so the calculation never reads zero-width
 * hidden tabs. useLayoutEffect applies the computed layout before the
 * browser paints, so there is no flash of a full-width strip.
 */
import { Menu, SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../context';
import {
  computeWorkspaceLayout,
  WORKSPACE_ICON_ONLY_THRESHOLD,
  type WorkspaceLayoutResult,
} from '../workspace/workspaceOverflow';
import { workspaceShortcutLabel } from '../workspace/workspaceShortcutLabel';
import {
  WORKSPACE_LABELS,
  WORKSPACE_OVERFLOW_ORDER,
  WORKSPACE_OVERFLOW_PRIORITY,
  type WorkspaceMode,
} from '../workspace/workspaceTypes';

/** Gap between tabs + container padding, added to each measured tab. */
const TAB_GAP = 6;
/** Width of the "More" overflow button (icon + padding). */
const OVERFLOW_BTN_WIDTH = 40;

const SOLID_ICON_NAMES: Record<WorkspaceMode, keyof typeof SOLID_CHROME_ICONS> = {
  design: 'penTool',
  print: 'printer',
  drawing: 'paintBrush',
  image: 'image',
  motion: 'play',
  codegen: 'code',
  logo: 'stamp',
};

const INITIAL_LAYOUT: WorkspaceLayoutResult = {
  visible: [...WORKSPACE_OVERFLOW_ORDER],
  overflow: [],
  iconOnly: false,
};

export function WorkspaceTabs() {
  const { state, requestWorkspaceSwitch } = useEditor();
  const wrapRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<WorkspaceMode, HTMLButtonElement | null>>>({});
  const naturalWidths = useRef<Partial<Record<WorkspaceMode, number>>>({});
  const [layout, setLayout] = useState<WorkspaceLayoutResult>(INITIAL_LAYOUT);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // Measure the flex-1 wrapper (stable regardless of tab count), never
    // the strip itself — the strip's width shrinks as tabs overflow, which
    // would otherwise collapse the measurement in a feedback loop.
    if (wrap.clientWidth <= 0) return;
    for (const mode of WORKSPACE_OVERFLOW_ORDER) {
      const el = tabRefs.current[mode];
      if (el && el.offsetWidth > 0) naturalWidths.current[mode] = el.offsetWidth + TAB_GAP;
    }
    setLayout(
      computeWorkspaceLayout({
        modes: WORKSPACE_OVERFLOW_ORDER,
        activeMode: state.workspaceMode,
        availableWidth: wrap.clientWidth,
        tabWidths: naturalWidths.current,
        overflowMenuWidth: OVERFLOW_BTN_WIDTH,
        overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
      }),
    );
  }, [state.workspaceMode]);

  // Measure before first paint (all tabs visible on the initial render).
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Re-measure as the wrapper resizes (window resizes, zoom changes, sidebar
  // toggles) and when the active mode changes.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [measure]);

  const handleSwitch = useCallback(
    (mode: WorkspaceMode) => {
      setMoreOpen(false);
      requestWorkspaceSwitch(mode);
    },
    [requestWorkspaceSwitch],
  );

  const iconOnly = wrapRef.current
    ? wrapRef.current.clientWidth < WORKSPACE_ICON_ONLY_THRESHOLD
    : layout.iconOnly;

  return (
    <div ref={wrapRef} className="workspace-tabs">
      <div className="workspace-tabs__strip" role="radiogroup" aria-label="Workspace">
        {layout.visible.map((mode) => (
          <Tooltip
            key={mode}
            label={`${WORKSPACE_LABELS[mode]} workspace`}
            shortcut={workspaceShortcutLabel(mode)}
          >
            {/* biome-ignore lint/a11y/useSemanticElements: APG radiogroup pattern uses role="radio" on buttons for custom segmented controls */}
            <button
              ref={(el) => {
                tabRefs.current[mode] = el;
              }}
              type="button"
              role="radio"
              aria-checked={state.workspaceMode === mode}
              aria-label={`${WORKSPACE_LABELS[mode]} workspace`}
              className={`workspace-tabs__tab${state.workspaceMode === mode ? ' workspace-tabs__tab--active' : ''}`}
              onClick={() => handleSwitch(mode)}
            >
              <SolidIcon name={SOLID_CHROME_ICONS[SOLID_ICON_NAMES[mode]]} size={15} />
              {!iconOnly && <span className="workspace-tabs__label">{WORKSPACE_LABELS[mode]}</span>}
            </button>
          </Tooltip>
        ))}
        {layout.overflow.length > 0 && (
          <>
            <span aria-hidden className="workspace-tabs__divider" />
            <Tooltip label="More workspaces">
              <button
                ref={moreTriggerRef}
                type="button"
                className={`workspace-tabs__more${moreOpen ? ' workspace-tabs__more--open' : ''}`}
                aria-label="More workspaces"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <SolidIcon name={SOLID_CHROME_ICONS.ellipsisVertical} size={15} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
      {layout.overflow.length > 0 && (
        <Menu
          triggerRef={moreTriggerRef}
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          label="More workspaces"
          items={layout.overflow.map((mode) => ({
            id: mode,
            label: WORKSPACE_LABELS[mode],
            onAction: () => handleSwitch(mode),
          }))}
        />
      )}
    </div>
  );
}

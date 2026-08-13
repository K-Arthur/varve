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
 * ARIA: APG radiogroup pattern (segmented control). Roving tabindex:
 * exactly one radio owns tabindex=0 (the focused/active one). Arrow keys
 * move focus and activate (automatic activation), Home/End jump to the
 * first/last, Enter/Space activate. The active workspace is never allowed
 * into the overflow menu, so the checked radio is always visible.
 *
 * Focus contract:
 * - Pointer activation never moves focus (no focus theft).
 * - Keyboard activation keeps focus on the activated radio (roving).
 * - Selecting a mode from the overflow menu moves focus to that mode's tab
 *   (it becomes the visible active tab), and the Menu restores focus to
 *   the "More" trigger when it closes without a selection.
 * - If the focused tab is pushed into overflow by a relayout, focus moves
 *   to the active tab.
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
import { useWorkspaceCustomizations } from '../workspace/useWorkspaceConfig';
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

/** Workspace modes use distinct, high-contrast Phosphor solid concepts. */
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

/**
 * Convert a display shortcut ("Ctrl+Shift+1" / mac glyphs) into valid
 * aria-keyshortcuts token grammar ("Control+Shift+1"): modifiers must be
 * spelled out, never display glyphs (APG key assignments).
 */
function toAriaKeyshortcuts(label: string): string {
  return label
    .replaceAll('\u2318', 'Meta+')
    .replaceAll('\u21E7', 'Shift+')
    .replaceAll('\u2325', 'Alt+')
    .replaceAll('\u2303', 'Control+')
    .replace('Ctrl+', 'Control+')
    .replaceAll('\u232B', 'Backspace');
}

export function WorkspaceTabs() {
  const { state, requestWorkspaceSwitch, resetWorkspaceToDefault } = useEditor();
  const customizations = useWorkspaceCustomizations();
  const wrapRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<WorkspaceMode, HTMLButtonElement | null>>>({});
  const naturalWidths = useRef<Partial<Record<WorkspaceMode, number>>>({});
  const [layout, setLayout] = useState<WorkspaceLayoutResult>(INITIAL_LAYOUT);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  // Roving focus index: the radio owning tabindex=0. Follows focus moves and
  // the active workspace (automatic activation ⇒ focus == selection).
  const [focusId, setFocusId] = useState<WorkspaceMode | null>(state.workspaceMode);
  const activatedFromOverflow = useRef(false);

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

  // Automatic activation: the active workspace is the focused radio, so
  // tabindex=0 follows it when a switch happens outside this component
  // (shortcut, command palette, deep link).
  useEffect(() => {
    setFocusId((f) => (f === state.workspaceMode ? f : state.workspaceMode));
  }, [state.workspaceMode]);

  // If the focused tab is pushed into overflow by a relayout, move focus to
  // the active tab (always visible).
  useEffect(() => {
    if (focusId && !layout.visible.includes(focusId)) {
      setFocusId(state.workspaceMode);
    }
  }, [layout, focusId, state.workspaceMode]);

  const focusMode = useCallback((mode: WorkspaceMode) => {
    setFocusId(mode);
    const el = tabRefs.current[mode];
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  const handleSwitch = useCallback(
    (mode: WorkspaceMode, opts?: { fromOverflow?: boolean }) => {
      setMoreOpen(false);
      if (opts?.fromOverflow) activatedFromOverflow.current = true;
      // Promise.resolve, not a bare .then: a switch path that answers
      // synchronously must not make the click handler throw.
      void Promise.resolve(requestWorkspaceSwitch(mode)).then((ok) => {
        if (ok && activatedFromOverflow.current) {
          // Keyboard/AT users who chose a mode from "More" land on the mode's
          // tab (now the active, visible radio) — deterministic next stop.
          focusMode(mode);
        }
        activatedFromOverflow.current = false;
      });
    },
    [requestWorkspaceSwitch, focusMode],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, mode: WorkspaceMode) => {
      const visible = layout.visible;
      const idx = visible.indexOf(mode);
      if (idx < 0) return;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          handleSwitch(visible[(idx + 1) % visible.length]!);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSwitch(visible[(idx - 1 + visible.length) % visible.length]!);
          break;
        case 'Home':
          e.preventDefault();
          if (visible.length > 0) handleSwitch(visible[0]!);
          break;
        case 'End':
          e.preventDefault();
          if (visible.length > 0) handleSwitch(visible[visible.length - 1]!);
          break;
        default:
          break;
      }
    },
    [layout.visible, handleSwitch],
  );

  const iconOnly = wrapRef.current
    ? wrapRef.current.clientWidth < WORKSPACE_ICON_ONLY_THRESHOLD
    : layout.iconOnly;

  const rovingId = focusId ?? state.workspaceMode;

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
              aria-keyshortcuts={toAriaKeyshortcuts(workspaceShortcutLabel(mode))}
              tabIndex={rovingId === mode ? 0 : -1}
              className={`workspace-tabs__tab${state.workspaceMode === mode ? ' workspace-tabs__tab--active' : ''}`}
              onClick={() => handleSwitch(mode)}
              onKeyDown={(e) => handleKeyDown(e, mode)}
              onFocus={() => setFocusId(mode)}
            >
              <SolidIcon name={SOLID_CHROME_ICONS[SOLID_ICON_NAMES[mode]]} size={15} />
              {!iconOnly && <span className="workspace-tabs__label">{WORKSPACE_LABELS[mode]}</span>}
              {customizations[mode] && (
                <>
                  <span className="workspace-tabs__customized-dot" aria-hidden="true" />
                  <span className="sr-only">customized</span>
                </>
              )}
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
                aria-haspopup="menu"
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
          items={[
            ...layout.overflow.map((mode) => ({
              id: mode,
              label: WORKSPACE_LABELS[mode],
              type: 'radio' as const,
              group: 'workspace-overflow' as const,
              checked: state.workspaceMode === mode,
              badge: workspaceShortcutLabel(mode),
              onAction: () => handleSwitch(mode, { fromOverflow: true }),
            })),
            { id: 'sep', separator: true as const },
            {
              id: 'reset-workspace',
              label: 'Reset Workspace to Default',
              onAction: () => resetWorkspaceToDefault(),
            },
          ]}
        />
      )}
    </div>
  );
}

/**
 * WorkspaceTabs — compact workspace switcher for the menubar.
 *
 * One segmented control (APG radiogroup): the active mode shows its name in
 * an accent pill; inactive modes are icon buttons. Modes that do not fit move
 * to a "More workspaces" overflow menu. The active mode is always visible
 * (computeWorkspaceLayout evicts a lower-priority tab if needed). Every mode
 * stays reachable via the overflow menu, keyboard shortcuts, and the command
 * palette at every width.
 *
 * ARIA: the `radiogroup` contains only radios. The divider and the overflow
 * trigger are siblings of the group, not children — a radiogroup whose
 * children include a button violates the role's ownership rules and makes the
 * overflow control unreliable for screen readers.
 *
 * Focus contract:
 * - Pointer activation never moves focus (no focus theft).
 * - Keyboard activation moves focus to the activated radio: in an APG radio
 *   group with automatic activation, focus and selection travel together.
 *   Without this, the roving tabindex and the DOM focus diverged after the
 *   first arrow press — a second ArrowRight was computed from the stale
 *   focused tab and did nothing, and ArrowLeft could wrap to the far end.
 * - Selecting a mode from the overflow menu moves focus to that mode's
 *   tab (it becomes the visible active tab), and the Menu restores
 *   focus to the "More" trigger when it closes without a selection.
 * - If the focused tab is pushed into overflow by a relayout, focus
 *   moves to the active tab.
 *
 * Measurement: natural tab widths are captured from rendered boxes (without
 * the inter-tab gap, which `computeWorkspaceLayout` adds from the measured
 * `column-gap`). Hidden tabs reuse their cached natural width, so the
 * calculation never reads zero-width hidden tabs. useLayoutEffect applies the
 * computed layout before the browser paints, so there is no flash of
 * a full-width strip.
 *
 * Hover feedback is CSS-only (a slight scale on the pointed icon). The
 * previous implementation ran a per-frame spring "fisheye" loop that wrote
 * `svg.style.width/height` for every item on every animation frame — one
 * forced style recalculation per item per frame for a visual effect whose
 * research record is negative: fisheye magnification anchored to the cursor
 * gives no motor-space benefit and is associated with hunting/distraction
 * (Zhai et al., CHI 2005; Cockburn & Firth, "Improving the Acquisition of
 * Small Targets"). The hit targets never changed size, so nothing is lost.
 */
import { Menu, TablerIcon, type TablerIconName, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { allowedWorkspaceModes } from '../capabilities/restrictions';
import { useEditor } from '../context';
import {
  computeWorkspaceLayout,
  WORKSPACE_TAB_GAP_FALLBACK,
  type WorkspaceLayoutResult,
} from '../workspace/workspaceOverflow';
import { workspaceShortcutLabel } from '../workspace/workspaceShortcutLabel';
import {
  WORKSPACE_LABELS,
  WORKSPACE_OVERFLOW_ORDER,
  WORKSPACE_OVERFLOW_PRIORITY,
  type WorkspaceMode,
} from '../workspace/workspaceTypes';

/** Width of the "More" overflow button (icon + padding). */
const OVERFLOW_BTN_WIDTH = 40;
/**
 * Horizontal chrome of `.workspace-dock__bar` (6px padding × 2 + 1px border
 * × 2). The overflow math must subtract it; without it the computed strip is
 * wider than the space the bar actually has, so the bar overflows its
 * wrapper — leftward, over the document title.
 */
const DOCK_CHROME_WIDTH = 14;

/** Heavy rounded Tabler line icons match the app chrome. */
const WORKSPACE_ICON_NAMES: Record<WorkspaceMode, TablerIconName> = {
  design: 'LayoutDashboard',
  print: 'Printer',
  drawing: 'Brush',
  image: 'Photo',
  motion: 'Play',
  codegen: 'Code',
  logo: 'Badge',
  email: 'FileText',
};

const INITIAL_LAYOUT: WorkspaceLayoutResult = {
  visible: [...WORKSPACE_OVERFLOW_ORDER],
  overflow: [],
  iconOnly: false,
  compactActive: false,
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

/**
 * Resolve the rendered inter-tab gap from the group's computed style. Falling
 * back to the documented constant keeps jsdom (no stylesheet) and the first
 * paint deterministic.
 */
function resolveTabGap(el: HTMLElement | null): number {
  if (!el) return WORKSPACE_TAB_GAP_FALLBACK;
  const gap = Number.parseFloat(getComputedStyle(el).columnGap);
  return Number.isFinite(gap) ? gap : WORKSPACE_TAB_GAP_FALLBACK;
}

export function WorkspaceTabs() {
  const { state, requestWorkspaceSwitch, resetWorkspaceToDefault } = useEditor();
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<WorkspaceMode, HTMLButtonElement | null>>>({});
  const naturalWidths = useRef<Partial<Record<WorkspaceMode, number>>>({});
  const [layout, setLayout] = useState<WorkspaceLayoutResult>(INITIAL_LAYOUT);
  const allowedModes = useMemo(() => allowedWorkspaceModes(WORKSPACE_OVERFLOW_ORDER), []);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const [focusId, setFocusId] = useState<WorkspaceMode | null>(state.workspaceMode);

  // ── Measurement + overflow ──
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (wrap.clientWidth <= 0) return;
    const tabGap = resolveTabGap(groupRef.current);
    for (const mode of allowedModes) {
      const el = tabRefs.current[mode];
      if (el && el.offsetWidth > 0) naturalWidths.current[mode] = el.offsetWidth;
    }
    setLayout(
      computeWorkspaceLayout({
        modes: allowedModes,
        activeMode: state.workspaceMode,
        availableWidth: Math.max(0, wrap.clientWidth - DOCK_CHROME_WIDTH),
        tabWidths: naturalWidths.current,
        overflowMenuWidth: OVERFLOW_BTN_WIDTH,
        overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
        tabGap,
      }),
    );
  }, [state.workspaceMode, allowedModes]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    // The bar's own box changes when its content does — a user font-size
    // preference, a webfont swap, a density change — even though the
    // flex-sized wrapper's width stays put. Without this the overflow math
    // keeps stale tab widths after a text-size change.
    if (barRef.current) ro.observe(barRef.current);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    setFocusId((f) => (f === state.workspaceMode ? f : state.workspaceMode));
  }, [state.workspaceMode]);

  useEffect(() => {
    if (focusId && !layout.visible.includes(focusId)) {
      setFocusId(state.workspaceMode);
    }
  }, [layout, focusId, state.workspaceMode]);

  // ── Interaction handlers ──
  const focusMode = useCallback((mode: WorkspaceMode) => {
    setFocusId(mode);
    const el = tabRefs.current[mode];
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  /**
   * Switch workspaces. `moveFocus` is set for keyboard and overflow-menu
   * activation — both are deliberate selections where the roving focus must
   * land on the tab that was chosen. Pointer clicks leave focus where the
   * browser put it (no focus theft).
   */
  const handleSwitch = useCallback(
    (mode: WorkspaceMode, opts?: { moveFocus?: boolean }) => {
      setMoreOpen(false);
      const moveFocus = opts?.moveFocus ?? false;
      void Promise.resolve(requestWorkspaceSwitch(mode)).then((ok) => {
        if (ok && moveFocus) focusMode(mode);
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
          handleSwitch(visible[(idx + 1) % visible.length]!, { moveFocus: true });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSwitch(visible[(idx - 1 + visible.length) % visible.length]!, {
            moveFocus: true,
          });
          break;
        case 'Home':
          e.preventDefault();
          if (visible.length > 0) handleSwitch(visible[0]!, { moveFocus: true });
          break;
        case 'End':
          e.preventDefault();
          if (visible.length > 0) handleSwitch(visible[visible.length - 1]!, { moveFocus: true });
          break;
        default:
          break;
      }
    },
    [layout.visible, handleSwitch],
  );

  const rovingId = focusId ?? state.workspaceMode;

  return (
    <div ref={wrapRef} className="workspace-dock">
      <div
        ref={barRef}
        className={`workspace-dock__bar${layout.compactActive ? ' workspace-dock--compact-active' : ''}`}
      >
        <div
          ref={groupRef}
          className="workspace-dock__group"
          role="radiogroup"
          aria-label="Workspace"
        >
          {layout.visible.map((mode) => {
            const isActive = state.workspaceMode === mode;

            return (
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
                  data-mode={mode}
                  aria-checked={isActive}
                  aria-label={`${WORKSPACE_LABELS[mode]} workspace`}
                  aria-keyshortcuts={toAriaKeyshortcuts(workspaceShortcutLabel(mode))}
                  tabIndex={rovingId === mode ? 0 : -1}
                  className={`workspace-dock__item${isActive ? ' workspace-dock__item--active' : ''}`}
                  onClick={() => handleSwitch(mode)}
                  onKeyDown={(e) => handleKeyDown(e, mode)}
                  onFocus={() => setFocusId(mode)}
                >
                  <span className="workspace-dock__icon">
                    <TablerIcon
                      name={WORKSPACE_ICON_NAMES[mode]}
                      size={16}
                      strokeWidth={2.25}
                      data-workspace-icon={WORKSPACE_ICON_NAMES[mode]}
                    />
                  </span>
                  {/* Inactive modes are icon-only; the active mode keeps its
                      name unless the strip is too narrow even for the pill, so
                      the desktop presentation always names the active
                      workspace. Only the active tab renders the label: a
                      collapsed label on the others would still be in the DOM,
                      and their measured width is what the overflow math reads. */}
                  {isActive && !layout.compactActive && (
                    <span className="workspace-dock__label">{WORKSPACE_LABELS[mode]}</span>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
        {layout.overflow.length > 0 && (
          <>
            <span aria-hidden className="workspace-dock__divider" />
            <Tooltip label="More workspaces">
              <button
                ref={moreTriggerRef}
                type="button"
                className={`workspace-dock__more${moreOpen ? ' workspace-dock__more--open' : ''}`}
                aria-label={`More workspaces (${layout.overflow.length} hidden)`}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((o) => !o)}
              >
                <TablerIcon name="DotsVertical" size={16} strokeWidth={2.25} />
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
          size="default"
          items={[
            ...layout.overflow.map((mode) => ({
              id: mode,
              label: WORKSPACE_LABELS[mode],
              type: 'radio' as const,
              group: 'workspace-overflow' as const,
              checked: state.workspaceMode === mode,
              badge: workspaceShortcutLabel(mode),
              onToggle: () => handleSwitch(mode, { moveFocus: true }),
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

export { ContextAwareShortcuts } from './ContextAwareShortcuts';

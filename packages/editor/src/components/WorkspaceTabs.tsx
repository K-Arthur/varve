/**
 * WorkspaceTabs — dock-style workspace switcher for the menubar.
 *
 * Inspired by the macOS Dock magnification effect: icons spring-scale
 * toward the cursor as the pointer moves across the strip. The active
 * mode expands into an accent-colored pill with its label; inactive
 * modes remain as compact circular icons.
 *
 * Responsive overflow is preserved from the original tab-strip: modes
 * that don't fit move to a "More" overflow menu. The active mode is
 * always visible (computeWorkspaceLayout evicts a lower-priority tab
 * if needed). Every mode stays reachable via the overflow menu,
 * keyboard shortcuts, and the command palette at every width.
 *
 * ARIA: APG radiogroup pattern (segmented control). Roving tabindex:
 * exactly one radio owns tabindex=0 (the focused/active one). Arrow
 * keys move focus and activate (automatic activation), Home/End jump
 * to the first/last, Enter/Space activate. The active workspace is
 * never allowed into the overflow menu, so the checked radio is
 * always visible.
 *
 * Focus contract:
 * - Pointer activation never moves focus (no focus theft).
 * - Keyboard activation keeps focus on the activated radio (roving).
 * - Selecting a mode from the overflow menu moves focus to that mode's
 *   tab (it becomes the visible active tab), and the Menu restores
 *   focus to the "More" trigger when it closes without a selection.
 * - If the focused tab is pushed into overflow by a relayout, focus
 *   moves to the active tab.
 *
 * Measurement: natural tab widths are captured on mount (all tabs
 * visible) and refreshed for visible tabs as the strip resizes;
 * hidden tabs reuse their cached natural width, so the calculation
 * never reads zero-width hidden tabs. useLayoutEffect applies the
 * computed layout before the browser paints, so there is no flash of
 * a full-width strip.
 *
 * Magnification: pure-JS spring physics (no animation library). Each
 * dock icon's scale is driven by a critically-damped spring targeting
 * a scale proportional to the inverse distance from the cursor. The
 * RAF loop writes directly to DOM style (no React re-renders per
 * frame) and runs only while the pointer is over the dock. Fully
 * disabled when the user prefers reduced motion.
 */
import { Menu, TablerIcon, type TablerIconName, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { allowedWorkspaceModes } from '../capabilities/restrictions';
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

/** Maximum icon scale at full magnification. */
const DOCK_ICON_MAX_SCALE = 1.55;
/** Pixel distance from cursor at which magnification drops to zero. */
const DOCK_DISTANCE_RANGE = 150;

// ── Spring physics ──
// Near-critically-damped: fast settle, minimal overshoot for a lively feel.
const SPRING_STIFFNESS = 220;
const SPRING_DAMPING = 26;
const SPRING_MASS = 1;
/** Stop the spring when this close to target (avoids infinite RAF). */
const SPRING_SNAP = 0.001;

interface SpringState {
  value: number;
  velocity: number;
}

function springStep(current: SpringState, target: number, dt: number): SpringState {
  const displacement = current.value - target;
  const springForce = -SPRING_STIFFNESS * displacement;
  const dampingForce = -SPRING_DAMPING * current.velocity;
  const acceleration = (springForce + dampingForce) / SPRING_MASS;
  const newVelocity = current.velocity + acceleration * dt;
  const newValue = current.value + newVelocity * dt;
  return { value: newValue, velocity: newVelocity };
}

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
 * Compute the target scale for a dock item at `distance` px from the
 * cursor. The hit target remains fixed; only the icon is transformed.
 */
function magnificationTarget(distance: number): number {
  const norm = 1 - Math.min(1, Math.max(0, distance / DOCK_DISTANCE_RANGE));
  return 1 + norm * (DOCK_ICON_MAX_SCALE - 1);
}

export function WorkspaceTabs() {
  const { state, requestWorkspaceSwitch, resetWorkspaceToDefault } = useEditor();
  const customizations = useWorkspaceCustomizations();
  const wrapRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<WorkspaceMode, HTMLButtonElement | null>>>({});
  const iconRefs = useRef<Partial<Record<WorkspaceMode, HTMLSpanElement | null>>>({});
  const naturalWidths = useRef<Partial<Record<WorkspaceMode, number>>>({});
  const [layout, setLayout] = useState<WorkspaceLayoutResult>(INITIAL_LAYOUT);
  const allowedModes = useMemo(() => allowedWorkspaceModes(WORKSPACE_OVERFLOW_ORDER), []);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const [focusId, setFocusId] = useState<WorkspaceMode | null>(state.workspaceMode);
  const activatedFromOverflow = useRef(false);
  // Ref for the active mode so the RAF loop always reads the current value.
  const activeModeRef = useRef(state.workspaceMode);
  activeModeRef.current = state.workspaceMode;

  // ── Magnification state (refs to avoid re-renders per frame) ──
  const mouseX = useRef(Infinity);
  const springs = useRef<Partial<Record<WorkspaceMode, SpringState>>>({});
  const rafId = useRef(0);
  const dockRect = useRef({ x: 0, width: 0 });
  const prefersReducedMotion = useRef(false);

  // ── Measurement + overflow ──
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (wrap.clientWidth <= 0) return;
    for (const mode of allowedModes) {
      const el = tabRefs.current[mode];
      if (el && el.offsetWidth > 0) naturalWidths.current[mode] = el.offsetWidth + TAB_GAP;
    }
    setLayout(
      computeWorkspaceLayout({
        modes: allowedModes,
        activeMode: state.workspaceMode,
        availableWidth: wrap.clientWidth,
        tabWidths: naturalWidths.current,
        overflowMenuWidth: OVERFLOW_BTN_WIDTH,
        overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
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

  // ── Reduced-motion detection ──
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      prefersReducedMotion.current = e.matches;
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Magnification animation loop ──
  // Writes directly to DOM style — no React re-renders per frame.
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    let lastTime = performance.now();
    let running = false;

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap dt to avoid spiral
      lastTime = now;
      let anyMoving = false;

      const rect = dockRect.current;
      const active = activeModeRef.current;
      for (const mode of layout.visible) {
        const el = tabRefs.current[mode];
        const iconEl = iconRefs.current[mode];
        if (!el || !iconEl) continue;

        // Skip the active item — CSS handles its sizing (expanding pill).
        if (mode === active) {
          iconEl.style.transform = '';
          continue;
        }

        // Measure center of this item relative to the dock container.
        const itemRect = el.getBoundingClientRect();
        const centerX = itemRect.left + itemRect.width / 2 - rect.x;
        const dist = Math.abs(mouseX.current - centerX);
        const target = magnificationTarget(dist);

        // Initialise spring if needed.
        if (!springs.current[mode]) {
          springs.current[mode] = { value: 1, velocity: 0 };
        }
        const s = springs.current[mode]!;
        const next = springStep(s, target, dt);
        s.value = next.value;
        s.velocity = next.velocity;

        if (Math.abs(s.value - target) > SPRING_SNAP || Math.abs(s.velocity) > SPRING_SNAP) {
          anyMoving = true;
        }

        // Write directly to DOM — no React re-render.
        iconEl.style.transform = `scale(${s.value})`;
      }

      if (anyMoving) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };

    const startLoop = () => {
      if (running || prefersReducedMotion.current) return;
      running = true;
      lastTime = performance.now();
      const rect = dock.getBoundingClientRect();
      dockRect.current = { x: rect.x, width: rect.width };
      rafId.current = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      running = false;
      mouseX.current = Infinity;
      // Snap icons back to base size immediately.
      for (const mode of layout.visible) {
        const el = tabRefs.current[mode];
        const iconEl = iconRefs.current[mode];
        if (!el || !iconEl) continue;
        const s = springs.current[mode];
        if (s) {
          s.value = 1;
          s.velocity = 0;
        }
        iconEl.style.transform = '';
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      mouseX.current = e.clientX - dockRect.current.x;
      if (!running) startLoop();
    };

    const onMouseLeave = () => {
      mouseX.current = Infinity;
      stopLoop();
    };

    dock.addEventListener('mousemove', onMouseMove);
    dock.addEventListener('mouseleave', onMouseLeave);

    return () => {
      dock.removeEventListener('mousemove', onMouseMove);
      dock.removeEventListener('mouseleave', onMouseLeave);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [layout.visible]);

  // ── Interaction handlers ──
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
      void Promise.resolve(requestWorkspaceSwitch(mode)).then((ok) => {
        if (ok && activatedFromOverflow.current) {
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
    <div ref={wrapRef} className="workspace-dock">
      <div ref={dockRef} className="workspace-dock__bar" role="radiogroup" aria-label="Workspace">
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
                <span
                  ref={(el) => {
                    iconRefs.current[mode] = el;
                  }}
                  className="workspace-dock__icon"
                >
                  <TablerIcon
                    name={WORKSPACE_ICON_NAMES[mode]}
                    size={15}
                    strokeWidth={2.25}
                    data-workspace-icon={WORKSPACE_ICON_NAMES[mode]}
                  />
                </span>
                {(!iconOnly || isActive) && (
                  <span className="workspace-dock__label">{WORKSPACE_LABELS[mode]}</span>
                )}
                {customizations[mode] && (
                  <>
                    <span className="workspace-dock__customized-dot" aria-hidden="true" />
                    <span className="sr-only">customized</span>
                  </>
                )}
              </button>
            </Tooltip>
          );
        })}
        {layout.overflow.length > 0 && (
          <>
            <span aria-hidden className="workspace-dock__divider" />
            <Tooltip label="More workspaces">
              <button
                ref={moreTriggerRef}
                type="button"
                className={`workspace-dock__more${moreOpen ? ' workspace-dock__more--open' : ''}`}
                aria-label="More workspaces"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((o) => !o)}
              >
                <TablerIcon name="DotsVertical" size={15} strokeWidth={2.25} />
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
              onToggle: () => handleSwitch(mode, { fromOverflow: true }),
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

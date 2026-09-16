/**
 * Deterministic workspace-tab overflow calculation for the editor top bar.
 *
 * With ~7 workspace modes, squeezing every label into the menubar at narrow
 * widths is what caused label/title overlap. The policy:
 *
 *   - Tabs are shown in a data-driven priority order (WORKSPACE_OVERFLOW
 *     in workspaceTypes.ts) — not conditional JSX.
 *   - The active workspace is ALWAYS visible: if the width math would push
 *     it into the overflow menu, a lower-priority visible tab is moved to
 *     the menu instead.
 *   - Hidden modes remain reachable via the overflow menu, keyboard
 *     shortcuts, and the command palette — never removed.
 *
 * Pure + side-effect free so the behavior is unit-testable; the component
 * feeds it measured tab widths (see WorkspaceTabs).
 */
import type { WorkspaceMode } from './workspaceTypes';

export interface WorkspaceLayoutInput {
  /** All modes, in display (priority) order. */
  modes: readonly WorkspaceMode[];
  /** The currently active mode — always kept visible. */
  activeMode: WorkspaceMode;
  /** Pixels available for the tab strip (container width). */
  availableWidth: number;
  /** Measured width of each tab's own box, keyed by mode. The inter-tab gap
   *  is NOT baked in; `tabGap` is added exactly once by this function so the
   *  rendered strip and the width math cannot drift. */
  tabWidths: Partial<Record<WorkspaceMode, number>>;
  /** Width of the "More" overflow button when present (px). */
  overflowMenuWidth: number;
  /** Overflow priority per mode — higher values leave the strip first.
   *  Absent modes default to 1. */
  overflowPriority: Partial<Record<WorkspaceMode, number>>;
  /**
   * Resolved CSS gap between adjacent tabs (px). The caller measures the
   * rendered `column-gap` so a token change in CSS flows into the math
   * instead of being duplicated here (the old implementation carried three
   * different values for this one distance: a CSS `gap: 5px`, a JS
   * `TAB_GAP = 6`, and an icon-tab constant that assumed 5).
   */
  tabGap?: number;
}

export interface WorkspaceLayoutResult {
  /** Modes rendered as tabs, in display order. */
  visible: WorkspaceMode[];
  /** Modes relegated to the overflow menu, in display order. */
  overflow: WorkspaceMode[];
  /** True when only icon-only tabs can fit (labels hidden). */
  iconOnly: boolean;
  /**
   * True when even the active mode must compact to an icon. False on desktop
   * strips, where the active mode keeps its name.
   */
  compactActive: boolean;
}

/** Width below which tabs drop their labels (icon-only strip). */
export const WORKSPACE_ICON_ONLY_THRESHOLD = 900;

/**
 * Rendered width of one icon-only tab button (px). Matches the dock's
 * `.workspace-dock__item` width; the inter-tab gap comes from `tabGap`, not
 * from a second copy of the value. Using a larger assumed width than the CSS
 * renders makes the computed strip wider than the space the bar actually has,
 * so the bar overflows its wrapper.
 */
export const WORKSPACE_ICON_BUTTON_WIDTH = 28;

/**
 * Fallback inter-tab gap (px) for environments that cannot resolve the CSS
 * `column-gap` (jsdom unit tests, pre-style first paint). Real browsers
 * measure the rendered value and pass it in.
 */
export const WORKSPACE_TAB_GAP_FALLBACK = 5;

/**
 * Minimum strip width that can show the active mode's label pill alongside
 * the overflow button. Below it the active mode compacts to an icon; above it
 * the active mode keeps its name (the desktop presentation).
 */
export const WORKSPACE_ACTIVE_LABEL_MIN_WIDTH = 210;

/**
 * Safety floor for the active mode's label pill width. The measured width can
 * be stale (it is captured while the pill was still compact), and
 * under-counting it is what lets the dock bar overflow leftward over the
 * document title. The pill is icon + gap + 6.5rem max label + padding.
 */
export const WORKSPACE_ACTIVE_PILL_MIN_WIDTH = 104;

export function computeWorkspaceLayout(input: WorkspaceLayoutInput): WorkspaceLayoutResult {
  const { modes, activeMode, availableWidth, tabWidths, overflowMenuWidth, overflowPriority } =
    input;
  const gap = input.tabGap ?? WORKSPACE_TAB_GAP_FALLBACK;

  /** Fallback width for a tab that has not been measured yet. */
  const DEFAULT_TAB_WIDTH = 64;
  const modeWidth = (m: WorkspaceMode): number => (tabWidths[m] ?? DEFAULT_TAB_WIDTH) + gap;

  // Icon-only strip: inactive tabs drop their labels. The active tab keeps
  // its name unless the strip is too narrow even for the active pill.
  const iconOnly = availableWidth < WORKSPACE_ICON_ONLY_THRESHOLD;
  const compactActive = availableWidth < WORKSPACE_ACTIVE_LABEL_MIN_WIDTH;
  const perTab = (m: WorkspaceMode): number => {
    // The active pill is wider than an icon; the overflow math must use its
    // measured width (with a safety floor for stale measurements) or the
    // strip overflows and covers the document title.
    if (m === activeMode && !compactActive) {
      return Math.max(tabWidths[m] ?? DEFAULT_TAB_WIDTH, WORKSPACE_ACTIVE_PILL_MIN_WIDTH) + gap;
    }
    return iconOnly ? WORKSPACE_ICON_BUTTON_WIDTH + gap : modeWidth(m);
  };

  const greedy: WorkspaceMode[] = [];
  let used = overflowMenuWidth;
  for (const mode of modes) {
    const next = used + perTab(mode);
    if (next <= availableWidth) {
      greedy.push(mode);
      used = next;
    } else if (mode === activeMode) {
      // The active mode must stay visible; evict the tab most willing to
      // overflow (highest overflowPriority; on ties, the lowest display
      // priority) to make room.
      greedy.push(mode);
      used = next;
      let evictAt = -1;
      let evictPriority = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < greedy.length - 1; i += 1) {
        const p = overflowPriority[greedy[i]!] ?? 1;
        // Strictly-greater so the LAST tied tab (lowest display priority)
        // wins the tie-break.
        if (p > evictPriority) {
          evictPriority = p;
          evictAt = i;
        }
      }
      if (evictAt >= 0) {
        greedy.splice(evictAt, 1);
        used = greedy.reduce((sum, m) => sum + perTab(m), 0) + overflowMenuWidth;
      }
    }
  }

  // In icon-only mode with no room for the overflow button, keep only the
  // active tab and put everything else in overflow.
  if (iconOnly) {
    const fits = greedy;
    if (fits.length === 0) {
      return {
        visible: [activeMode],
        overflow: modes.filter((m) => m !== activeMode),
        iconOnly,
        compactActive,
      };
    }
  }

  const visible = greedy;
  const overflow = modes.filter((m) => !visible.includes(m));
  return { visible, overflow, iconOnly, compactActive };
}

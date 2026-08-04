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
  /** Measured or estimated width of each tab, keyed by mode. */
  tabWidths: Partial<Record<WorkspaceMode, number>>;
  /** Width of the "More" overflow button when present (px). */
  overflowMenuWidth: number;
  /** Overflow priority per mode — higher values leave the strip first.
   *  Absent modes default to 1. */
  overflowPriority: Partial<Record<WorkspaceMode, number>>;
}

export interface WorkspaceLayoutResult {
  /** Modes rendered as tabs, in display order. */
  visible: WorkspaceMode[];
  /** Modes relegated to the overflow menu, in display order. */
  overflow: WorkspaceMode[];
  /** True when only icon-only tabs can fit (labels hidden). */
  iconOnly: boolean;
}

/** Width below which tabs drop their labels (icon-only strip). */
export const WORKSPACE_ICON_ONLY_THRESHOLD = 900;

export function computeWorkspaceLayout(input: WorkspaceLayoutInput): WorkspaceLayoutResult {
  const { modes, activeMode, availableWidth, tabWidths, overflowMenuWidth, overflowPriority } =
    input;

  const modeWidth = (m: WorkspaceMode): number => tabWidths[m] ?? 64;

  // Icon-only strip: every tab is roughly the same width; if the strip
  // can't fit the count, fall back to a single active tab + overflow.
  const iconOnly = availableWidth < WORKSPACE_ICON_ONLY_THRESHOLD;
  const perTab = (m: WorkspaceMode): number => (iconOnly ? 32 : modeWidth(m));

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
      return { visible: [activeMode], overflow: modes.filter((m) => m !== activeMode), iconOnly };
    }
  }

  const visible = greedy;
  const overflow = modes.filter((m) => !visible.includes(m));
  return { visible, overflow, iconOnly };
}

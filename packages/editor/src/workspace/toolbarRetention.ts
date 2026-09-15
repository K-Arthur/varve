/**
 * Responsive retention policy for the floating palette.
 *
 * When the tool row runs out of width the palette must hide *something*; this
 * module decides what yields first. It replaces the previous ad-hoc
 * `FRONT_FACING_TOOL_IDS` set, which pinned `shapeBuilder` and the boolean
 * *actions* but not Rect/Text/Frame. At the default 1280×720 window with both
 * side panels open the palette therefore hid the Shapes, Text, and Layout
 * groups behind a More menu while keeping a disabled Boolean flyout in the
 * row — the most common creation tools cost three interactions while a
 * context-dependent command stayed visible.
 *
 * Retention is scored per tool (higher survives longer) and aggregated per
 * group by its minimum member score, so a group is only as durable as its
 * least durable member. Essential recovery/navigation tools and the active
 * tool's group are pinned outside this policy entirely.
 *
 * Scores are a presentation policy, not a claim about any user's workflow.
 * They encode: creation before editing, editing before measurement, and
 * measurement before context-dependent commands and AI helpers. The registry
 * `category` supplies the default; explicit overrides cover tools whose
 * category does not describe how often they are reached for (Slice, Warp).
 */

import { getToolDefinition } from '../tools/toolRegistry';
import type { ToolId } from '../tools/types';
import {
  getToolbarSlotToolIds,
  type ToolbarGroup,
  type ToolbarSlot,
  toolbarSlotKey,
} from './toolbarComposition';

/** Category-level default retention. */
const CATEGORY_RETENTION: Record<string, number> = {
  navigation: 100,
  shapes: 90,
  typography: 90,
  layout: 85,
  vector: 80,
  drawing: 70,
  selection: 65,
  raster: 50,
  inspect: 40,
  prototype: 30,
  collaboration: 30,
  ai: 20,
};

/** Tools whose reachability differs from their registry category. */
const TOOL_RETENTION_OVERRIDES: Partial<Record<ToolId, number>> = {
  // Primary creation tools declared under generic categories.
  pen: 88,
  line: 84,
  arrow: 82,
  table: 70,
  page: 70,
  // Measurement surfaces that live in `layout`/`selection` categories.
  slice: 40,
  scale: 55,
  pixelProbe: 42,
  eyedropper: 60,
  inspect: 38,
  // Advanced vector/AI helpers yield before measurement.
  warp: 30,
  sam2Segment: 20,
  // Boolean operations are selection commands, not tools: they are disabled
  // unless two or more closed vector shapes are selected. They are also
  // reachable from the context bar and the selection quick bar, so the
  // palette should give up its slot before any selectable tool does.
  booleanUnion: 0,
  booleanSubtract: 0,
  booleanIntersect: 0,
  booleanExclude: 0,
};

/** Retention score for one tool. Unknown tools are treated as low priority. */
export function toolRetention(toolId: ToolId): number {
  const override = TOOL_RETENTION_OVERRIDES[toolId];
  if (override !== undefined) return override;
  const category = getToolDefinition(toolId)?.category;
  if (category && category in CATEGORY_RETENTION) {
    return CATEGORY_RETENTION[category] ?? 30;
  }
  return 30;
}

/** Group retention: the minimum member score, with action flyouts forced last. */
export function groupRetention(group: ToolbarGroup): number {
  const ids = group.slots.flatMap(getToolbarSlotToolIds);
  if (ids.length === 0) return 0;
  return Math.min(...ids.map(toolRetention));
}

/** Slot retention: a flyout is only as durable as its least durable member. */
export function slotRetention(slot: ToolbarSlot): number {
  const ids = getToolbarSlotToolIds(slot);
  if (ids.length === 0) return 0;
  return Math.min(...ids.map(toolRetention));
}

/**
 * Pick the next slot to collapse: the lowest retention score wins; ties keep
 * declared order with the later slot yielding first (it is further from the
 * palette's leading edge).
 */
export function nextSlotToCollapse(
  candidates: ToolbarSlot[],
  collapsedIds: readonly string[],
): ToolbarSlot | null {
  let pick: ToolbarSlot | null = null;
  let pickIndex = -1;
  candidates.forEach((slot, index) => {
    const key = toolbarSlotKey(slot);
    if (collapsedIds.includes(key)) return;
    if (!pick) {
      pick = slot;
      pickIndex = index;
      return;
    }
    const diff = slotRetention(slot) - slotRetention(pick);
    if (diff < 0 || (diff === 0 && index > pickIndex)) {
      pick = slot;
      pickIndex = index;
    }
  });
  return pick;
}

/**
 * Pick the next group to collapse. Retained for callers that reason about the
 * declared groups as a whole; the floating palette collapses per slot so a
 * group's measurement tools do not pin its selection tools.
 */
export function nextGroupToCollapse(
  candidates: ToolbarGroup[],
  collapsedIds: readonly string[],
): ToolbarGroup | null {
  let pick: ToolbarGroup | null = null;
  let pickIndex = -1;
  candidates.forEach((group, index) => {
    if (collapsedIds.includes(group.id)) return;
    if (!pick) {
      pick = group;
      pickIndex = index;
      return;
    }
    const diff = groupRetention(group) - groupRetention(pick);
    if (diff < 0 || (diff === 0 && index > pickIndex)) {
      pick = group;
      pickIndex = index;
    }
  });
  return pick;
}

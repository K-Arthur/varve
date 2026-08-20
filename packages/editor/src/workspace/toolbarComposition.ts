/**
 * Toolbar composition — turns a workspace's declared `ToolbarConfig` into the
 * ordered slots the floating toolbar renders.
 *
 * Why this module exists: `FloatingToolbar` used to own two hard-coded arrays
 * (`INDIVIDUAL_TOOLS` / `DRAWING_TOOLS`) that decided both the order of the
 * toolbar and which tools could appear at all. `WorkspaceConfig.toolbar` was
 * consulted only as a visibility filter, so the config's declared order and its
 * `flyouts[].tools` lists were decorative — a direct violation of workspace
 * invariant 9 ("every WorkspaceConfig field must have a runtime consumer").
 *
 * Three concrete defects came from that split:
 *
 * 1. Declared order was ignored. Every workspace rendered in the hard-coded
 *    order, so Image mode led with Line/Text instead of the Select/Crop/retouch
 *    order its config declares for photo work.
 * 2. Tools the hard-coded arrays did not list were unreachable even though the
 *    workspace declared them and `@varve/ui` ships icons for them —
 *    `nodeEdit` (Logo), `refineMask` / `trimapEdit` (Image).
 * 3. Flyout contents were hard-coded, so `flyouts[].tools` never applied and
 *    boolean operations could not be hidden by workspace customization
 *    (the preference sanitizer only accepted ids present in `toolbar.tools`).
 *
 * The composition is pure and structural. Visibility policy stays in
 * `workspaceStore.getEffectiveWorkspaceConfig`, which applies the user's
 * per-workspace overrides before the config reaches this module, so there is
 * exactly one place that decides "is this tool shown" and one that decides
 * "where does it go".
 *
 * Flyout placement: a flyout is anchored at the position of the first declared
 * tool it owns, and takes over that tool's group separator. A flyout whose
 * tools are not part of the main row at all (boolean operations are actions,
 * not selectable tools) is appended after the main row.
 */

import type { ToolId } from '../tools/types';
import type { ToolbarConfig } from './workspaceTypes';

/** A flyout rendered as a primary button plus a chevron menu. */
export interface ToolbarFlyoutSlot {
  kind: 'flyout';
  id: string;
  label: string;
  tools: ToolId[];
  groupStart?: boolean;
}

/** A single tool button in the main row. */
export interface ToolbarToolSlot {
  kind: 'tool';
  toolId: ToolId;
  groupStart?: boolean;
}

export type ToolbarSlot = ToolbarToolSlot | ToolbarFlyoutSlot;

/** A contiguous declared toolbar group, split at `groupStart` boundaries. */
export interface ToolbarGroup {
  id: string;
  slots: ToolbarSlot[];
}

/** Return the tool ids represented by one rendered slot, including flyouts. */
export function getToolbarSlotToolIds(slot: ToolbarSlot): ToolId[] {
  return slot.kind === 'tool' ? [slot.toolId] : slot.tools;
}

/**
 * Preserve workspace-declared group boundaries for responsive composition.
 * This deliberately does not assign categories or visibility; those remain
 * registry and effective-config concerns respectively.
 */
export function groupToolbarSlots(slots: ToolbarSlot[]): ToolbarGroup[] {
  const groups: ToolbarGroup[] = [];
  for (const [index, slot] of slots.entries()) {
    const startsGroup = groups.length === 0 || slot.groupStart === true;
    if (startsGroup) {
      const anchor = slot.kind === 'tool' ? slot.toolId : slot.id;
      groups.push({ id: `${anchor}-${index}`, slots: [] });
    }
    groups.at(-1)?.slots.push(slot);
  }
  return groups;
}

/**
 * Compose the ordered toolbar slots for a workspace.
 *
 * The input must already be the *effective* toolbar config (built-in config
 * merged with the user's visibility overrides).
 */
export function composeToolbar(toolbar: ToolbarConfig): ToolbarSlot[] {
  const declared: ToolbarConfig['tools'] = [];
  const seen = new Set<ToolId>();
  // A workspace config (or a hand-edited preference payload that produced one)
  // may repeat a tool; render the first occurrence only so the toolbar never
  // shows two buttons for the same tool.
  for (const item of toolbar.tools) {
    if (seen.has(item.toolId)) continue;
    seen.add(item.toolId);
    declared.push(item);
  }

  const claimed = new Map<ToolId, string>();
  const flyouts: ToolbarFlyoutSlot[] = [];
  for (const flyout of toolbar.flyouts ?? []) {
    const tools: ToolId[] = [];
    for (const toolId of flyout.tools) {
      // A tool belongs to at most one flyout; the first declaration wins so a
      // malformed config cannot make the same tool disappear from the main row
      // twice over.
      if (tools.includes(toolId) || claimed.has(toolId)) continue;
      tools.push(toolId);
    }
    // An empty flyout would render a chevron that opens nothing. This is
    // reachable through customization: hiding every shape leaves the shapes
    // flyout with no members.
    if (tools.length === 0) continue;
    for (const toolId of tools) claimed.set(toolId, flyout.id);
    flyouts.push({ kind: 'flyout', id: flyout.id, label: flyout.label, tools });
  }

  const slots: ToolbarSlot[] = [];
  const placed = new Set<string>();
  for (const item of declared) {
    const owner = claimed.get(item.toolId);
    if (owner === undefined) {
      slots.push({ kind: 'tool', toolId: item.toolId, groupStart: item.groupStart });
      continue;
    }
    // Anchor the flyout at its first declared member and inherit that member's
    // separator, so a config that starts a group with `rect` still starts a
    // group with the Shapes flyout that replaces it.
    if (placed.has(owner)) continue;
    placed.add(owner);
    const flyout = flyouts.find((f) => f.id === owner);
    if (flyout) slots.push({ ...flyout, groupStart: item.groupStart });
  }

  // Flyouts whose members never appear in the main row (boolean operations)
  // have no anchor — append them so they stay reachable.
  for (const flyout of flyouts) {
    if (placed.has(flyout.id)) continue;
    slots.push({ ...flyout, groupStart: true });
  }

  return slots;
}

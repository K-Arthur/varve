import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ESSENTIAL_TOOL_IDS } from '../../tools/toolRegistry';
import type { ToolId } from '../../tools/types';
import {
  getToolbarSlotToolIds,
  groupToolbarSlots,
  type ToolbarSlot,
  toolbarSlotKey,
} from '../../workspace/toolbarComposition';
import { nextSlotToCollapse } from '../../workspace/toolbarRetention';

interface ResponsiveToolbar {
  rootRef: RefObject<HTMLDivElement | null>;
  visibleSlots: ToolbarSlot[];
  collapsedSlots: ToolbarSlot[];
}

/**
 * Collapse individual toolbar slots only when the rendered row overflows, in
 * ascending retention order (see `toolbarRetention.ts`). Essential recovery
 * tools and the active tool's slot are never candidates; everything else can
 * be discovered through the category-based More menu.
 *
 * Collapse granularity is the *slot*, not the declared group. Group-level
 * collapse was too coarse: the Select group also declares Slice, Pixel Info,
 * Scale, and Inspect, so pinning the group to keep Select in the row also
 * pinned four measurement tools — and at 1280x720 with both panels open the
 * palette still had to give up Text, Frame, Table, Pen, Knife and Shape
 * Builder to make room for them.
 *
 * Collapse is one-way until the container resizes or the composition changes:
 * re-expanding as soon as the row happens to fit would oscillate between
 * "all visible → overflow → collapse one → fits → expand" on every pass.
 */
export function useToolbarOverflow(slots: ToolbarSlot[], activeTool: ToolId): ResponsiveToolbar {
  const rootRef = useRef<HTMLDivElement>(null);
  const [collapsedSlotIds, setCollapsedSlotIds] = useState<string[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const lastContainerSize = useRef<{ height: number; width: number } | null>(null);
  const previousGroupKey = useRef<string | null>(null);

  const slotKey = useMemo(
    () =>
      slots
        .map((slot) => `${toolbarSlotKey(slot)}:${getToolbarSlotToolIds(slot).join(',')}`)
        .join('|'),
    [slots],
  );
  const candidates = useMemo(
    () => slots.filter((slot) => !isPinnedSlot(slot, activeTool)),
    [slots, activeTool],
  );
  const candidateIdSet = useMemo(
    () => new Set(candidates.map((slot) => toolbarSlotKey(slot))),
    [candidates],
  );

  useLayoutEffect(() => {
    const toolbar = rootRef.current;
    const container = toolbar?.parentElement;
    if (!container) return;

    const notifyContainerResize = (width: number, height: number) => {
      const previous = lastContainerSize.current;
      if (previous?.width === width && previous.height === height) return;
      lastContainerSize.current = { width, height };
      setCollapsedSlotIds((collapsed) => (collapsed.length === 0 ? collapsed : []));
      setLayoutVersion((version) => version + 1);
    };

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => {
        if (entry) notifyContainerResize(entry.contentRect.width, entry.contentRect.height);
      });
      observer.observe(container);
      return () => observer.disconnect();
    }

    if (typeof window === 'undefined') return;
    const onWindowResize = () => {
      setCollapsedSlotIds((collapsed) => (collapsed.length === 0 ? collapsed : []));
      setLayoutVersion((version) => version + 1);
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  useLayoutEffect(() => {
    const row = rootRef.current?.querySelector<HTMLElement>('[role="toolbar"]');
    if (!row) return;
    if (slotKey !== previousGroupKey.current) {
      previousGroupKey.current = slotKey;
      setCollapsedSlotIds((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    const overflowing = row.scrollWidth > row.clientWidth + 1;

    setCollapsedSlotIds((previous) => {
      const valid = previous.filter((id) => candidateIdSet.has(id));
      if (overflowing) {
        const next = nextSlotToCollapse(candidates, valid);
        if (next) return [...valid, toolbarSlotKey(next)];
        return valid.length === previous.length ? previous : valid;
      }
      return valid.length === previous.length ? previous : valid;
    });
  }, [candidateIdSet, candidates, collapsedSlotIds, slotKey, layoutVersion]);

  const collapsedSet = new Set(collapsedSlotIds);
  const visibleSlots = promoteGroupStarts(
    slots.filter((slot) => !collapsedSet.has(toolbarSlotKey(slot))),
    slots,
  );
  return {
    rootRef,
    visibleSlots,
    collapsedSlots: slots.filter((slot) => collapsedSet.has(toolbarSlotKey(slot))),
  };
}

/** Stable identity for a slot across re-renders. */
function isPinnedSlot(slot: ToolbarSlot, activeTool: ToolId): boolean {
  return getToolbarSlotToolIds(slot).some((id) => ESSENTIAL_TOOL_IDS.has(id) || id === activeTool);
}

/**
 * Keep a separator at the start of each declared group's first surviving slot.
 * Without this, removing the first slot of a group merges its remaining tools
 * into the previous group and the palette loses the visual boundaries the
 * workspace declared.
 */
function promoteGroupStarts(visible: ToolbarSlot[], declared: ToolbarSlot[]): ToolbarSlot[] {
  const groups = groupToolbarSlots(declared);
  const promoted = new Set<ToolbarSlot>();
  for (const group of groups) {
    const firstVisible = group.slots.find((slot) => visible.includes(slot));
    if (firstVisible) promoted.add(firstVisible);
  }
  return visible.map((slot) => {
    if (promoted.has(slot) && !slot.groupStart) return { ...slot, groupStart: true };
    if (!promoted.has(slot) && slot.groupStart) return { ...slot, groupStart: false };
    return slot;
  });
}

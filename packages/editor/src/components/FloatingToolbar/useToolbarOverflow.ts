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

const NO_PINNED_TOOLS: readonly ToolId[] = [];

/**
 * Collapse individual toolbar slots only when the rendered row overflows, in
 * ascending retention order (see `toolbarRetention.ts`). Essential recovery
 * tools, user-pinned tools, and the active tool's slot are never candidates;
 * everything else can be discovered through the category-based More menu.
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
export function useToolbarOverflow(
  slots: ToolbarSlot[],
  activeTool: ToolId,
  pinnedToolIds: readonly ToolId[] = NO_PINNED_TOOLS,
): ResponsiveToolbar {
  const rootRef = useRef<HTMLDivElement>(null);
  const [collapsedSlotIds, setCollapsedSlotIds] = useState<string[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const lastContainerSize = useRef<number | null>(null);
  const previousGroupKey = useRef<string | null>(null);

  const slotKey = useMemo(
    () =>
      slots
        .map((slot) => `${toolbarSlotKey(slot)}:${getToolbarSlotToolIds(slot).join(',')}`)
        .join('|'),
    [slots],
  );
  const candidates = useMemo(
    () => slots.filter((slot) => !isPinnedSlot(slot, activeTool, pinnedToolIds)),
    [slots, activeTool, pinnedToolIds],
  );
  const candidateKey = candidates
    .map((slot) => `${toolbarSlotKey(slot)}:${getToolbarSlotToolIds(slot).join(',')}`)
    .join('|');
  const candidateIdSet = useMemo(
    () => new Set(candidates.map((slot) => toolbarSlotKey(slot))),
    [candidateKey],
  );

  useLayoutEffect(() => {
    const toolbar = rootRef.current;
    // The toolbar's parent is the whole editor shell, but the menu row is
    // constrained by the central canvas dock. Observe that actual dock cell
    // so opening/moving a side panel recomputes overflow against the space
    // left for the canvas instead of reacting to unrelated shell geometry.
    const container =
      toolbar
        ?.closest<HTMLElement>('.editor-shell')
        ?.querySelector<HTMLElement>('.editor-shell__canvas-dock') ?? toolbar?.parentElement;
    if (!container) return;
    let resizeFrame: number | null = null;

    const notifyContainerResize = (width: number) => {
      const previous = lastContainerSize.current;
      // The overflow decision is horizontal. Ignore fractional width jitter
      // from animated dock tracks so a ResizeObserver delivery cannot keep
      // scheduling layout state while the workspace is settling.
      if (previous !== null && Math.abs(previous - width) < 1) return;
      lastContainerSize.current = width;
      if (resizeFrame !== null) return;
      const refresh = () => {
        resizeFrame = null;
        setCollapsedSlotIds((collapsed) => (collapsed.length === 0 ? collapsed : []));
        setLayoutVersion((version) => version + 1);
      };
      resizeFrame =
        typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame(refresh)
          : window.setTimeout(refresh, 0);
    };

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => {
        if (entry) notifyContainerResize(entry.contentRect.width);
      });
      observer.observe(container);
      return () => {
        observer.disconnect();
        if (resizeFrame !== null) {
          if (typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(resizeFrame);
          } else {
            window.clearTimeout(resizeFrame);
          }
        }
      };
    }

    if (typeof window === 'undefined') return;
    const onWindowResize = () => {
      notifyContainerResize(container.getBoundingClientRect().width);
    };
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.removeEventListener('resize', onWindowResize);
      if (resizeFrame !== null) {
        if (typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(resizeFrame);
        } else {
          window.clearTimeout(resizeFrame);
        }
      }
    };
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
  }, [candidateKey, candidateIdSet, collapsedSlotIds, slotKey, layoutVersion]);

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
function isPinnedSlot(
  slot: ToolbarSlot,
  activeTool: ToolId,
  pinnedToolIds: readonly ToolId[],
): boolean {
  return getToolbarSlotToolIds(slot).some(
    (id) => ESSENTIAL_TOOL_IDS.has(id) || id === activeTool || pinnedToolIds.includes(id),
  );
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

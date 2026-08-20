import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ESSENTIAL_TOOL_IDS } from '../../tools/toolRegistry';
import type { ToolId } from '../../tools/types';
import {
  getToolbarSlotToolIds,
  groupToolbarSlots,
  type ToolbarGroup,
  type ToolbarSlot,
} from '../../workspace/toolbarComposition';

interface ResponsiveToolbarGroups {
  rootRef: RefObject<HTMLDivElement | null>;
  visibleGroups: ToolbarGroup[];
  collapsedGroups: ToolbarGroup[];
}

/**
 * Collapse declared toolbar groups only when their rendered row overflows.
 * Essential recovery groups and the active tool's group remain in the row;
 * the rest can be discovered through the category-based More menu.
 */
export function useToolbarOverflow(
  slots: ToolbarSlot[],
  activeTool: ToolId,
): ResponsiveToolbarGroups {
  const rootRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupToolbarSlots(slots), [slots]);
  const pinnedGroupIds = useMemo(() => {
    const pinned = new Set<string>();
    for (const group of groups) {
      const ids = group.slots.flatMap(getToolbarSlotToolIds);
      if (ids.some((id) => ESSENTIAL_TOOL_IDS.has(id) || id === activeTool)) {
        pinned.add(group.id);
      }
    }
    return pinned;
  }, [activeTool, groups]);
  const candidates = useMemo(
    () => groups.filter((group) => !pinnedGroupIds.has(group.id)),
    [groups, pinnedGroupIds],
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const lastContainerSize = useRef<{ height: number; width: number } | null>(null);
  const previousGroupKey = useRef<string | null>(null);
  const groupKey = groups
    .map(
      (group) =>
        `${group.id}:${group.slots.map((slot) => getToolbarSlotToolIds(slot).join(',')).join('|')}`,
    )
    .join(';');

  useLayoutEffect(() => {
    const toolbar = rootRef.current;
    const container = toolbar?.parentElement;
    if (!container) return;

    const notifyContainerResize = (width: number, height: number) => {
      const previous = lastContainerSize.current;
      if (previous?.width === width && previous.height === height) return;
      lastContainerSize.current = { width, height };
      setCollapsedGroupIds((collapsed) => (collapsed.length === 0 ? collapsed : []));
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
      setCollapsedGroupIds((collapsed) => (collapsed.length === 0 ? collapsed : []));
      setLayoutVersion((version) => version + 1);
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  useLayoutEffect(() => {
    const row = rootRef.current?.querySelector<HTMLElement>('[role="toolbar"]');
    if (!row) return;
    if (groupKey !== previousGroupKey.current) {
      previousGroupKey.current = groupKey;
      setCollapsedGroupIds((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    const candidateIds = new Set(candidates.map((group) => group.id));
    const overflowing = row.scrollWidth > row.clientWidth + 1;

    setCollapsedGroupIds((previous) => {
      const valid = previous.filter((id) => candidateIds.has(id));
      if (overflowing) {
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
          const candidate = candidates[index];
          if (!candidate) continue;
          if (!valid.includes(candidate.id)) return [...valid, candidate.id];
        }
        return valid.length === previous.length ? previous : valid;
      }
      return valid.length === previous.length ? previous : valid;
    });
  }, [candidates, collapsedGroupIds, groupKey, layoutVersion]);

  const collapsed = new Set(collapsedGroupIds);
  return {
    rootRef,
    visibleGroups: groups.filter((group) => !collapsed.has(group.id)),
    collapsedGroups: groups.filter((group) => collapsed.has(group.id)),
  };
}

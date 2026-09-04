import { Menu, type MenuItem } from '@varve/ui';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { InspectorTabConfig, InspectorTabId } from '../../workspace/workspaceTypes';

export interface InspectorTabBarProps {
  tabs: readonly InspectorTabConfig[];
  activeTab: InspectorTabId;
  onActivate: (tab: InspectorTabId, moveFocus?: boolean) => void;
  onDetach?: ReactNode;
}

/**
 * Choose low-priority tabs for the overflow menu without changing the order
 * of the tabs that remain in the tablist. Priority 0 is pinned. The active
 * tab is also pinned so a contextual change never makes the selected surface
 * disappear from the user's view.
 */
export function getOverflowedInspectorTabIds(
  tabs: readonly InspectorTabConfig[],
  availableWidth: number,
  tabWidths: ReadonlyMap<InspectorTabId, number>,
  activeTab: InspectorTabId,
): InspectorTabId[] {
  if (availableWidth <= 0) return [];

  const totalWidth = tabs.reduce((sum, tab) => sum + (tabWidths.get(tab.id) ?? 0), 0);
  if (totalWidth <= availableWidth) return [];

  const overflowed = new Set<InspectorTabId>();
  const candidates = tabs
    .map((tab, index) => ({
      id: tab.id,
      index,
      priority: tab.overflowPriority ?? 1,
    }))
    .filter(({ id, priority }) => id !== activeTab && priority > 0)
    .sort((a, b) => b.priority - a.priority || b.index - a.index);

  let remainingWidth = totalWidth;
  for (const candidate of candidates) {
    if (remainingWidth <= availableWidth) break;
    overflowed.add(candidate.id);
    remainingWidth -= tabWidths.get(candidate.id) ?? 0;
  }

  return tabs.filter((tab) => overflowed.has(tab.id)).map((tab) => tab.id);
}

function sameIds(a: readonly InspectorTabId[], b: readonly InspectorTabId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function estimateTabWidth(label: string): number {
  // Used only before layout exists (SSR/jsdom) or for a tab temporarily
  // hidden by the previous measurement. The live DOM measurement wins.
  return Math.max(56, label.length * 7 + 24);
}

export function InspectorTabBar({ tabs, activeTab, onActivate, onDetach }: InspectorTabBarProps) {
  const tabListRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef(new Map<InspectorTabId, HTMLButtonElement>());
  const [overflowedIds, setOverflowedIds] = useState<InspectorTabId[]>([]);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const measureOverflow = useCallback(() => {
    const tabList = tabListRef.current;
    if (!tabList || tabList.clientWidth <= 0) {
      setOverflowedIds((current) => (current.length === 0 ? current : []));
      return;
    }

    const tabWidths = new Map<InspectorTabId, number>();
    for (const tab of tabs) {
      const width = tabRefs.current.get(tab.id)?.getBoundingClientRect().width ?? 0;
      tabWidths.set(tab.id, width > 0 ? width : estimateTabWidth(tab.label));
    }

    // The More button is a sibling flex item. When it is visible, the browser
    // has already reduced the tablist's client width by that button's width;
    // subtracting it here again would hide an unnecessary extra tab.
    const availableWidth = tabList.clientWidth;
    const next = getOverflowedInspectorTabIds(tabs, availableWidth, tabWidths, activeTab);
    setOverflowedIds((current) => (sameIds(current, next) ? current : next));
  }, [activeTab, overflowedIds.length, tabs]);

  useEffect(() => {
    measureOverflow();
    const tabList = tabListRef.current;
    if (!tabList || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(tabList);
    return () => observer.disconnect();
  }, [measureOverflow]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) return;
    if (!overflowedIds.includes(activeTab)) return;
    setOverflowedIds((current) => current.filter((id) => id !== activeTab));
  }, [activeTab, overflowedIds, tabs]);

  const overflowed = useMemo(() => new Set<InspectorTabId>(overflowedIds), [overflowedIds]);
  const visibleTabs = tabs.filter((tab) => !overflowed.has(tab.id));
  const overflowTabs = tabs.filter((tab) => overflowed.has(tab.id));
  const overflowItems = useMemo<readonly MenuItem[]>(
    () =>
      overflowTabs.map((tab) => ({
        id: `inspector-overflow-${tab.id}`,
        label: tab.label,
        onAction: () => {
          setOverflowOpen(false);
          onActivate(tab.id);
        },
      })),
    [onActivate, overflowTabs],
  );

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent, index: number) => {
      if (visibleTabs.length === 0) return;
      let nextIndex: number | undefined;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % visibleTabs.length;
      if (event.key === 'ArrowLeft')
        nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = visibleTabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      const nextTab = visibleTabs[nextIndex];
      if (!nextTab) return;
      onActivate(nextTab.id, true);
      tabRefs.current.get(nextTab.id)?.focus({ preventScroll: true });
    },
    [onActivate, visibleTabs],
  );

  return (
    <div className="insp-panel__tabs-row">
      <div
        ref={tabListRef}
        className="insp-panel__tabs"
        role="tablist"
        aria-label="Inspector tabs"
        data-has-overflow={overflowTabs.length > 0 ? 'true' : undefined}
      >
        {visibleTabs.map((tab, index) => {
          const previous = visibleTabs[index - 1];
          const startsGroup =
            previous && (previous.group ?? 'workflow') !== (tab.group ?? 'workflow');
          return (
            <button
              type="button"
              key={tab.id}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              id={`insp-tab-${tab.id}`}
              role="tab"
              className="insp-panel__tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`insp-tabpanel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              data-tab-group={tab.group ?? 'workflow'}
              data-tab-group-start={startsGroup ? 'true' : undefined}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {overflowTabs.length > 0 && (
        <>
          <button
            ref={overflowTriggerRef}
            type="button"
            className="insp-panel__tab-overflow"
            aria-label={`More inspector tabs (${overflowTabs.length})`}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((open) => !open)}
          >
            More
          </button>
          <Menu
            items={overflowItems}
            triggerRef={overflowTriggerRef}
            open={overflowOpen}
            onClose={() => setOverflowOpen(false)}
            label="More inspector tabs"
          />
        </>
      )}
      {onDetach}
    </div>
  );
}

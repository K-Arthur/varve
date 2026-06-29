/**
 * APG Tabs — accessible, keyboard-navigable tab widget.
 *
 * Follows the ARIA Authoring Practices Guide Tabs pattern:
 *   - role="tablist" / role="tab" / role="tabpanel"
 *   - Roving tabindex (only the active tab is in tab order)
 *   - ArrowLeft/Right (horizontal), Home/End navigation
 *   - Automatic activation on focus (Enter/Space not required)
 *   - aria-controls ↔ aria-labelledby bidirectional wiring
 *
 * Research basis: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 */

import {
  Children,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useId,
  useRef,
} from 'react';
import type { IconName } from '../icons/Icon';
import { Icon } from '../icons/Icon';

export interface Tab<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface TabsProps<T extends string> {
  label: string;
  tabs: readonly Tab<T>[];
  activeTab: T;
  onTabChange: (value: T) => void;
  children: ReactNode;
}

function TabsInner<T extends string>({
  label,
  tabs,
  activeTab,
  onTabChange,
  children,
}: TabsProps<T>) {
  const baseId = useId();
  const tablistRef = useRef<HTMLDivElement>(null);
  const childrenArray = Children.toArray(children) as ReactElement[];
  const activeIndex = tabs.findIndex((t) => t.value === activeTab);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const current = activeIndex;
      let next = current;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          next = (current + 1) % tabs.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          next = (current - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          e.preventDefault();
          next = 0;
          break;
        case 'End':
          e.preventDefault();
          next = tabs.length - 1;
          break;
        default:
          return;
      }
      if (next < 0 || next >= tabs.length) return;
      onTabChange(tabs[next]!.value);
      const btn = document.getElementById(`${baseId}-tab-${next}`);
      btn?.focus();
    },
    [activeIndex, baseId, onTabChange, tabs],
  );

  return (
    <div className="strata-tabs">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={label}
        className="strata-tablist"
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab, i) => {
          const isActive = tab.value === activeTab;
          const tabId = `${baseId}-tab-${i}`;
          const panelId = `${baseId}-panel-${tab.value}`;
          return (
            <button
              key={tab.value}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={i === activeIndex ? 0 : -1}
              className="strata-tab"
              onClick={() => onTabChange(tab.value)}
            >
              {tab.icon && <Icon name={tab.icon} label={undefined} size="0.95em" />}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      {tabs.map((tab, i) => {
        const isActive = tab.value === activeTab;
        const panelId = `${baseId}-panel-${tab.value}`;
        const tabId = `${baseId}-tab-${i}`;
        return (
          <div
            key={tab.value}
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId}
            hidden={!isActive}
            className="strata-tabpanel"
          >
            {isActive ? (childrenArray[i] ?? null) : null}
          </div>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>(props: TabsProps<T>) {
  return <TabsInner {...props} />;
}

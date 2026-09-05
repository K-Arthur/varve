/**
 * APG Tabs — accessible, keyboard-navigable tab widget.
 *
 * Follows the ARIA Authoring Practices Guide Tabs pattern:
 *   - role="tablist" / role="tab" / role="tabpanel"
 *   - Roving tabindex (only the active tab is in tab order)
 *   - ArrowLeft/Right (horizontal), Home/End navigation
 *   - Automatic activation on focus (Enter/Space not required)
 *   - aria-controls <-> aria-labelledby bidirectional wiring
 *
 * Research basis: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 */

import {
  Children,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { IconName } from '../icons/Icon';
import { Icon } from '../icons/Icon';

export interface Tab<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** Supplemental content such as a count or status badge. */
  badge?: ReactNode;
  disabled?: boolean;
  /** Used when the visible label is intentionally hidden, such as an icon tab. */
  iconOnly?: boolean;
  ariaLabel?: string;
}

export type TabsOrientation = 'horizontal' | 'vertical';
export type TabsVariant = 'underline' | 'soft' | 'pill' | 'panel' | 'compact';
export type TabsSize = 'sm' | 'md' | 'lg';
export type TabsActivation = 'automatic' | 'manual';

export interface TabsProps<T extends string> {
  label: string;
  tabs: readonly Tab<T>[];
  activeTab: T;
  onTabChange: (value: T) => void;
  /**
   * Legacy positional panel content. Prefer renderPanel for dynamic tabs so
   * panel identity follows the stable tab value instead of an array index.
   */
  children?: ReactNode;
  /** Render a panel from its stable tab value. */
  renderPanel?: (tab: Tab<T>, index: number) => ReactNode;
  orientation?: TabsOrientation;
  variant?: TabsVariant;
  size?: TabsSize;
  activation?: TabsActivation;
  /** Keep inactive panels mounted when they own form, scroll, or editor state. */
  unmountInactivePanels?: boolean;
  className?: string;
  tabListClassName?: string;
  panelClassName?: string;
}

function tabIdPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%', '_');
}

function TabsInner<T extends string>({
  label,
  tabs,
  activeTab,
  onTabChange,
  renderPanel,
  orientation = 'horizontal',
  variant = 'underline',
  size = 'md',
  activation = 'automatic',
  unmountInactivePanels = true,
  className,
  tabListClassName,
  panelClassName,
  children,
}: TabsProps<T>) {
  const baseId = useId();
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());
  const childrenArray = Children.toArray(children);
  const firstEnabledIndex = tabs.findIndex((tab) => !tab.disabled);
  const requestedIndex = tabs.findIndex((tab) => tab.value === activeTab && !tab.disabled);
  // A controlled value can briefly be stale while a dynamic collection is
  // updating. Keep one deterministic selected tab so the widget never loses
  // its tab stop or presents an all-hidden panel state.
  const activeIndex = requestedIndex >= 0 ? requestedIndex : firstEnabledIndex;
  const activeValue = tabs[activeIndex]?.value;
  const [focusedValue, setFocusedValue] = useState<T | undefined>(activeValue);
  const previousActiveValue = useRef(activeValue);

  useEffect(() => {
    const activeChanged = previousActiveValue.current !== activeValue;
    previousActiveValue.current = activeValue;
    setFocusedValue((current) => {
      if (!activeChanged && current && tabs.some((tab) => tab.value === current && !tab.disabled)) {
        return current;
      }
      return activeValue;
    });
  }, [activeValue, tabs]);

  const tabbableValue =
    focusedValue && tabs.some((tab) => tab.value === focusedValue && !tab.disabled)
      ? focusedValue
      : activeValue;

  const focusTab = useCallback((value: T) => {
    setFocusedValue(value);
    const element = tabRefs.current.get(value);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
      const focusedIndex = target
        ? tabs.findIndex((tab) => tab.value === target.dataset.tabValue)
        : -1;
      const current = focusedIndex >= 0 ? focusedIndex : activeIndex;
      const enabledIndices = tabs
        .map((tab, index) => (!tab.disabled ? index : -1))
        .filter((index) => index >= 0);
      if (enabledIndices.length === 0) return;

      let nextIndex = -1;
      const forward = orientation === 'vertical' ? e.key === 'ArrowDown' : e.key === 'ArrowRight';
      const backward = orientation === 'vertical' ? e.key === 'ArrowUp' : e.key === 'ArrowLeft';
      if (forward || backward) {
        const enabledPosition = enabledIndices.indexOf(current);
        const position = enabledPosition < 0 ? 0 : enabledPosition;
        const delta = forward ? 1 : -1;
        nextIndex =
          enabledIndices[(position + delta + enabledIndices.length) % enabledIndices.length] ?? -1;
      } else if (e.key === 'Home') {
        nextIndex = enabledIndices[0] ?? -1;
      } else if (e.key === 'End') {
        nextIndex = enabledIndices[enabledIndices.length - 1] ?? -1;
      } else if (activation === 'manual' && (e.key === 'Enter' || e.key === ' ')) {
        const focused = tabs[current];
        if (!focused || focused.disabled) return;
        e.preventDefault();
        onTabChange(focused.value);
        return;
      } else {
        return;
      }

      e.preventDefault();
      if (nextIndex < 0) return;
      const nextTab = tabs[nextIndex];
      if (!nextTab) return;
      focusTab(nextTab.value);
      if (activation === 'automatic') onTabChange(nextTab.value);
    },
    [activation, activeIndex, focusTab, onTabChange, orientation, tabs],
  );

  return (
    <div
      className={`varve-tabs varve-tabs--${variant} varve-tabs--${orientation} varve-tabs--${size}${className ? ` ${className}` : ''}`}
      data-activation={activation}
    >
      <div
        role="tablist"
        aria-label={label}
        aria-orientation={orientation === 'vertical' ? 'vertical' : undefined}
        className={`varve-tablist${tabListClassName ? ` ${tabListClassName}` : ''}`}
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab) => {
          const isActive = tab.value === activeValue;
          const tabId = `${baseId}-tab-${tabIdPart(tab.value)}`;
          const panelId = `${baseId}-panel-${tabIdPart(tab.value)}`;
          return (
            <button
              key={tab.value}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              aria-label={tab.iconOnly ? (tab.ariaLabel ?? tab.label) : tab.ariaLabel}
              aria-disabled={tab.disabled || undefined}
              tabIndex={!tab.disabled && tab.value === tabbableValue ? 0 : -1}
              disabled={tab.disabled}
              data-tab-value={tab.value}
              className={`varve-tab${tab.iconOnly ? ' varve-tab--icon-only' : ''}`}
              onFocus={() => setFocusedValue(tab.value)}
              onClick={() => {
                setFocusedValue(tab.value);
                if (!tab.disabled) onTabChange(tab.value);
              }}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.value, element);
                else tabRefs.current.delete(tab.value);
              }}
            >
              {tab.icon && <Icon name={tab.icon} label={undefined} size="0.95em" />}
              <span
                className={tab.iconOnly ? 'varve-tab__label varve-sr-only' : 'varve-tab__label'}
              >
                {tab.label}
              </span>
              {tab.badge !== undefined && <span className="varve-tab__badge">{tab.badge}</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => {
        const isActive = tab.value === activeValue;
        const panelId = `${baseId}-panel-${tabIdPart(tab.value)}`;
        const tabId = `${baseId}-tab-${tabIdPart(tab.value)}`;
        return (
          <div
            key={tab.value}
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId}
            hidden={!isActive}
            tabIndex={isActive ? 0 : -1}
            className={`varve-tabpanel${panelClassName ? ` ${panelClassName}` : ''}`}
          >
            {(isActive || !unmountInactivePanels) && !tab.disabled
              ? renderPanel
                ? renderPanel(tab, index)
                : (childrenArray[index] ?? null)
              : null}
          </div>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>(props: TabsProps<T>) {
  return <TabsInner {...props} />;
}

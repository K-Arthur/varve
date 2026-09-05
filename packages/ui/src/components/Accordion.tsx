/**
 * Accordion — coordinated Disclosure group.
 *
 * An Accordion manages open state across multiple DisclosureItems. Supports
 * single (one-at-a-time) and multiple (independent) expansion modes.
 * Single mode optionally allows collapsing the last item.
 *
 * Each AccordionItem wraps a DisclosureTrigger + DisclosureContent pair.
 * The Accordion root handles state; items delegate to it via context.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Accordion context
// ---------------------------------------------------------------------------

interface AccordionContextValue {
  /** Returns whether the given value is currently open. */
  isOpen: (value: string) => boolean;
  /** Toggle open/closed for the given value. */
  toggle: (value: string) => void;
  /** Base ID for generating unique content IDs. */
  baseId: string;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);
AccordionContext.displayName = 'AccordionContext';

function useAccordionContext(consumer: string): AccordionContextValue {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error(`${consumer} must be used within <Accordion>`);
  return ctx;
}

// ---------------------------------------------------------------------------
// Accordion (root)
// ---------------------------------------------------------------------------

export interface AccordionProps {
  /**
   * Controlled: currently open values. When provided, the accordion is controlled.
   * For single mode, pass a single value string or empty string for none.
   */
  value?: string | string[];
  /**
   * Default open values for uncontrolled operation.
   * For single mode, pass a single value string.
   */
  defaultValue?: string | string[];
  /**
   * Expansion mode:
   * - 'multiple' (default): any number of items can be open simultaneously.
   * - 'single': only one item at a time; opening one closes others.
   */
  mode?: 'multiple' | 'single';
  /**
   * In single mode, allow collapsing the last open item (returns to empty state).
   * Defaults to false.
   */
  collapsible?: boolean;
  /** Callback when the set of open values changes. */
  onValueChange?: (value: string | string[]) => void;
  /** Density variant applied to all items. */
  variant?: 'compact' | 'standard';
  /** Additional CSS class on the root element. */
  className?: string;
  /** Accessible label for the accordion region. */
  label?: string;
  /** Children must be <AccordionItem> components. */
  children: ReactNode;
}

export function Accordion({
  value: controlledValue,
  defaultValue,
  mode = 'multiple',
  collapsible = false,
  onValueChange,
  variant = 'standard',
  className = '',
  label,
  children,
}: AccordionProps) {
  const baseId = useId();
  const isControlled = controlledValue !== undefined;

  // Normalize to array for internal use
  const toArray = useCallback((v: string | string[] | undefined): string[] => {
    if (v === undefined) return [];
    return Array.isArray(v) ? v : [v];
  }, []);

  const [uncontrolledOpen, setUncontrolledOpen] = useState<string[]>(() => {
    if (controlledValue !== undefined) return toArray(controlledValue);
    if (defaultValue !== undefined) return toArray(defaultValue);
    return [];
  });

  const openValues = isControlled ? toArray(controlledValue) : uncontrolledOpen;

  const isOpen = useCallback((val: string) => openValues.includes(val), [openValues]);

  const toggle = useCallback(
    (val: string) => {
      const currentlyOpen = openValues.includes(val);
      let next: string[];

      if (mode === 'single') {
        if (currentlyOpen && collapsible) {
          next = [];
        } else if (currentlyOpen) {
          return; // Can't collapse in non-collapsible single mode
        } else {
          next = [val];
        }
      } else {
        // Multiple mode
        next = currentlyOpen ? openValues.filter((v) => v !== val) : [...openValues, val];
      }

      if (!isControlled) setUncontrolledOpen(next);
      if (mode === 'single') {
        onValueChange?.(next[0] ?? '');
      } else {
        onValueChange?.(next);
      }
    },
    [openValues, mode, collapsible, isControlled, onValueChange],
  );

  const ctx = useMemo<AccordionContextValue>(
    () => ({ isOpen, toggle, baseId }),
    [isOpen, toggle, baseId],
  );

  return (
    <AccordionContext.Provider value={ctx}>
      <div
        role="presentation"
        data-variant={variant}
        data-mode={mode}
        className={`varve-accordion ${className}`.trim()}
        aria-label={label}
      >
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// AccordionItem
// ---------------------------------------------------------------------------

export interface AccordionItemProps {
  /** Unique value identifying this item within the Accordion. */
  value: string;
  /** Whether this item is disabled (cannot be toggled). */
  disabled?: boolean;
  /** Content: typically <AccordionTrigger> + <AccordionContent>. */
  children: ReactNode;
  /** Additional CSS class on the item wrapper. */
  className?: string;
}

const ItemContext = createContext<{ value: string; disabled: boolean } | null>(null);
ItemContext.displayName = 'AccordionItemContext';

export function useAccordionItemContext(consumer: string) {
  const ctx = useContext(ItemContext);
  if (!ctx) throw new Error(`${consumer} must be used within <AccordionItem>`);
  return ctx;
}

export function AccordionItem({
  value,
  disabled = false,
  children,
  className = '',
}: AccordionItemProps) {
  const { isOpen } = useAccordionContext('AccordionItem');
  const open = isOpen(value);

  const itemCtx = useMemo(() => ({ value, disabled }), [value, disabled]);

  return (
    <ItemContext.Provider value={itemCtx}>
      <div
        data-state={open ? 'open' : 'closed'}
        data-disabled={disabled || undefined}
        className={`varve-accordion__item ${className}`.trim()}
      >
        {children}
      </div>
    </ItemContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// AccordionTrigger — renders a Disclosure-style trigger wired to Accordion state
// ---------------------------------------------------------------------------

export interface AccordionTriggerProps {
  /** Trigger label content. */
  children: ReactNode;
  /** Additional CSS class on the button. */
  className?: string;
  /** Icon rendered before children. */
  leadingIcon?: ReactNode;
  /** Indicator rendered at the end (default: chevron). Pass null to hide. */
  indicator?: ReactNode;
  /** Hide the default chevron indicator. */
  hideIndicator?: boolean;
}

const DEFAULT_CHEVRON = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
    className="varve-disclosure__chevron-icon"
  >
    <path
      d="M4.5 3L7.5 6L4.5 9"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function AccordionTrigger({
  children,
  className = '',
  leadingIcon,
  indicator,
  hideIndicator = false,
}: AccordionTriggerProps) {
  const { isOpen, toggle, baseId } = useAccordionContext('AccordionTrigger');
  const { value, disabled } = useAccordionItemContext('AccordionTrigger');
  const open = isOpen(value);
  const contentId = `${baseId}-content-${value}`;

  const renderedIndicator = hideIndicator ? null : (indicator ?? DEFAULT_CHEVRON);

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={contentId}
      aria-disabled={disabled || undefined}
      data-state={open ? 'open' : 'closed'}
      className={`varve-disclosure__trigger varve-accordion__trigger ${className}`.trim()}
      disabled={disabled}
      onClick={() => toggle(value)}
    >
      {leadingIcon && (
        <span className="varve-disclosure__leading-icon" aria-hidden="true">
          {leadingIcon}
        </span>
      )}
      <span className="varve-disclosure__label">{children}</span>
      {renderedIndicator && (
        <span className="varve-disclosure__indicator" aria-hidden="true">
          {renderedIndicator}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AccordionContent — renders a Disclosure-style content panel wired to Accordion state
// ---------------------------------------------------------------------------

export interface AccordionContentProps {
  /** Content rendered when the item is open. */
  children: ReactNode;
  /** Additional CSS class on the content wrapper. */
  className?: string;
  /**
   * When true, content remains in the DOM when closed (hidden via `hidden` attribute).
   * Defaults to false (content unmounts when closed).
   */
  keepMounted?: boolean;
}

export function AccordionContent({
  children,
  className = '',
  keepMounted = false,
}: AccordionContentProps) {
  const { isOpen, baseId } = useAccordionContext('AccordionContent');
  const { value } = useAccordionItemContext('AccordionContent');
  const open = isOpen(value);
  const contentId = `${baseId}-content-${value}`;

  if (!keepMounted && !open) return null;

  return (
    <section
      id={contentId}
      hidden={!open || undefined}
      data-state={open ? 'open' : 'closed'}
      className={`varve-disclosure__content varve-accordion__content ${className}`.trim()}
    >
      {children}
    </section>
  );
}

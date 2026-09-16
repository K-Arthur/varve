/**
 * Disclosure — APG Disclosure (Show/Hide) primitive.
 *
 * Research basis: WAI-ARIA Authoring Practices 1.2 — Disclosure.
 * A button toggles visibility of a content panel via aria-expanded and
 * aria-controls. Composable: <Disclosure> wraps <DisclosureTrigger> +
 * <DisclosureContent>.
 *
 * Supports controlled and uncontrolled operation, compact/standard density
 * variants, leading icons, header actions, and status indicators.
 *
 * Keyboard handling is native: the trigger is a real <button>, so Enter and
 * Space activate it without extra key handlers (APG accordion/disclosure
 * keyboard contract). A manual keydown handler must not be added back — it
 * would run alongside native activation and can double-toggle with assistive
 * technology.
 */
import {
  createContext,
  type FocusEventHandler,
  forwardRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Focus restore
// ---------------------------------------------------------------------------

/**
 * Keeps focus from being dropped on <body> when a disclosure panel closes
 * while focus is inside it.
 *
 * Real-world failure this prevents: a keyboard user has focus on a control in
 * an open section and the section collapses (via a command, the section
 * manager, an accordion sibling, or a recycled row). The focused element is
 * removed from the DOM and the browser silently moves focus to <body>, so the
 * user loses their place with no announcement.
 *
 * The hook only restores focus when focus was genuinely lost — it never
 * steals focus from a deliberate destination (another control, another
 * accordion item, an outside click).
 */
export function useDisclosureFocusRestore({
  open,
  rootRef,
  triggerRef,
}: {
  open: boolean;
  rootRef: React.RefObject<HTMLElement | null>;
  triggerRef?: React.RefObject<HTMLElement | null>;
}): { onFocus: FocusEventHandler<HTMLElement>; onBlur: FocusEventHandler<HTMLElement> } {
  const hadFocusInsideRef = useRef(false);

  const onFocus = useCallback<FocusEventHandler<HTMLElement>>(() => {
    hadFocusInsideRef.current = true;
  }, []);

  const onBlur = useCallback<FocusEventHandler<HTMLElement>>(
    (event) => {
      const next = event.relatedTarget as Node | null;
      const root = rootRef.current;
      if (!next || !root?.contains(next)) {
        hadFocusInsideRef.current = false;
      }
    },
    [rootRef],
  );

  useEffect(() => {
    if (open || !hadFocusInsideRef.current) return;
    hadFocusInsideRef.current = false;

    const root = rootRef.current;
    const ownerDocument = root?.ownerDocument;
    const active = ownerDocument?.activeElement ?? null;
    const trigger =
      triggerRef?.current ?? root?.querySelector<HTMLElement>('.varve-disclosure__trigger') ?? null;

    // Focus was dropped to <body> when the panel unmounted, or it is still on
    // an element inside this disclosure that is no longer on screen. Anything
    // else is a deliberate destination and is left alone.
    const focusDropped = !active || active === ownerDocument?.body;
    const strandedInside = Boolean(active) && Boolean(root?.contains(active)) && active !== trigger;

    if (focusDropped || strandedInside) {
      trigger?.focus();
    }
  }, [open, rootRef, triggerRef]);

  return { onFocus, onBlur };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface DisclosureContextValue {
  open: boolean;
  toggle: () => void;
  contentId: string;
  disabled: boolean;
}

const DisclosureContext = createContext<DisclosureContextValue | null>(null);
DisclosureContext.displayName = 'DisclosureContext';

function useDisclosureContext(consumer: string): DisclosureContextValue {
  const ctx = useContext(DisclosureContext);
  if (!ctx) throw new Error(`${consumer} must be used within <Disclosure>`);
  return ctx;
}

// ---------------------------------------------------------------------------
// Disclosure (root)
// ---------------------------------------------------------------------------

export interface DisclosureProps {
  /** Controlled open state. When provided, the component is controlled. */
  open?: boolean;
  /** Default open state for uncontrolled operation. */
  defaultOpen?: boolean;
  /** Callback when the user toggles the disclosure. */
  onOpenChange?: (open: boolean) => void;
  /** When true, the trigger cannot be activated. */
  disabled?: boolean;
  /** Density variant: 'compact' for dense sidebars, 'standard' for panels/settings. */
  variant?: 'compact' | 'standard';
  /** Children must include <DisclosureTrigger> and <DisclosureContent>. */
  children: ReactNode;
  /** Additional CSS class on the root element. */
  className?: string;
}

export function Disclosure({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  variant = 'standard',
  children,
  className = '',
}: DisclosureProps) {
  const contentId = useId();
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const rootRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    if (disabled) return;
    const next = !open;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [disabled, open, isControlled, onOpenChange]);

  const focusRestore = useDisclosureFocusRestore({ open, rootRef });

  const ctx = useMemo<DisclosureContextValue>(
    () => ({ open, toggle, contentId, disabled }),
    [open, toggle, contentId, disabled],
  );

  return (
    <DisclosureContext.Provider value={ctx}>
      <div
        ref={rootRef}
        {...focusRestore}
        data-variant={variant}
        data-state={open ? 'open' : 'closed'}
        data-disabled={disabled || undefined}
        className={`varve-disclosure ${className}`.trim()}
      >
        {children}
      </div>
    </DisclosureContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// DisclosureTrigger
// ---------------------------------------------------------------------------

export interface DisclosureTriggerProps {
  /** Children rendered inside the trigger button. */
  children: ReactNode;
  /** Additional CSS class on the button. */
  className?: string;
  /** Icon rendered before the children. */
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

export const DisclosureTrigger = forwardRef<HTMLButtonElement, DisclosureTriggerProps>(
  function DisclosureTrigger(
    { children, className = '', leadingIcon, indicator, hideIndicator = false },
    ref,
  ) {
    const { open, toggle, contentId, disabled } = useDisclosureContext('DisclosureTrigger');

    const renderedIndicator = hideIndicator ? null : (indicator ?? DEFAULT_CHEVRON);

    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        aria-disabled={disabled || undefined}
        data-state={open ? 'open' : 'closed'}
        className={`varve-disclosure__trigger ${className}`.trim()}
        disabled={disabled}
        onClick={toggle}
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
  },
);

// ---------------------------------------------------------------------------
// DisclosureContent
// ---------------------------------------------------------------------------

export interface DisclosureContentProps {
  /** Content rendered when open. */
  children: ReactNode;
  /** Additional CSS class on the content wrapper. */
  className?: string;
  /**
   * When true, content remains in the DOM when closed (hidden via `hidden` attribute).
   * Useful when content has expensive state (form values, canvas) that should be preserved.
   * Defaults to false (content unmounts when closed).
   */
  keepMounted?: boolean;
}

export const DisclosureContent = forwardRef<HTMLDivElement, DisclosureContentProps>(
  function DisclosureContent({ children, className = '', keepMounted = false }, ref) {
    const { open, contentId } = useDisclosureContext('DisclosureContent');

    if (!keepMounted && !open) return null;

    return (
      <section
        ref={ref}
        id={contentId}
        hidden={!open || undefined}
        data-state={open ? 'open' : 'closed'}
        className={`varve-disclosure__content ${className}`.trim()}
      >
        {children}
      </section>
    );
  },
);

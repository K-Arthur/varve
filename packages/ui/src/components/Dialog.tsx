import {
  type DialogHTMLAttributes,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from 'react';
import { Button } from './Button';
import { NestedOverlayProvider, useNestedOverlayRegistry } from './NestedOverlayContext';

// A consumer opts out of the internal dismissal behavior by calling
// preventDefault in its own handler. Whether the event was ALREADY
// default-prevented before reaching the dialog is not consulted: descendants
// (a Select consuming Escape, a form control consuming Enter) routinely
// preventDefault, and treating that as "skip dialog dismissal" would silently
// take over the job of the nested-overlay guard. Module-scope: it closes over
// nothing component-specific, so it stays referentially stable for the
// useCallback hooks below instead of forcing them to depend on it.
function consumerOptedOut<E extends React.SyntheticEvent>(
  e: E,
  handler: ((e: E) => void) | undefined,
): boolean {
  if (!handler) return false;
  const preventedBefore = e.defaultPrevented;
  handler(e);
  return !preventedBefore && e.defaultPrevented;
}

export interface DialogProps extends DialogHTMLAttributes<HTMLDialogElement> {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** When true, clicking the backdrop dismisses the dialog. */
  dismissible?: boolean;
  /** Size variant: 'sm' (default) or 'lg' (wider, used by preset browsers). */
  size?: 'sm' | 'lg';
  /** Sticky footer content, rendered below the scrollable body. */
  footer?: ReactNode;
  /**
   * When true, initial focus lands on the first actionable control in the
   * body instead of the header Close button (WCAG 2.4.3 — the Close button
   * is the first focusable element in DOM order but almost never the control
   * the user opened the dialog for). Per-dialog opt-in so existing dialogs
   * keep their current behavior.
   */
  focusFirstControl?: boolean;
}

/**
 * A press that starts inside the dialog and is released over the backdrop
 * (selecting text, dragging a scrub gesture, releasing past the edge) is
 * dispatched as a click on the dialog element itself, because the element is
 * the nearest common ancestor of the press and release targets. Dismissing on
 * that click closes the dialog mid-interaction. Backdrop dismissal therefore
 * requires both the press and the release to have happened on the dialog's
 * own backdrop area — tracked separately from the click event.
 */
interface BackdropPress {
  down: boolean;
  up: boolean;
}

const CLEARED_PRESS: BackdropPress = { down: false, up: false };

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  {
    open,
    onClose,
    title,
    children,
    dismissible = true,
    size = 'sm',
    footer,
    className = '',
    focusFirstControl = false,
    onCancel: consumerOnCancel,
    onClick: consumerOnClick,
    onKeyDown: consumerOnKeyDown,
    ...rest
  },
  ref,
) {
  const innerRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const backdropPressRef = useRef<BackdropPress>(CLEARED_PRESS);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      if (focusFirstControl) {
        // An explicit data-autofocus marker is authoritative regardless of
        // document order: querySelector returns the first match in document
        // order, so a plain <input> earlier in the body would otherwise beat
        // a deliberately marked control later in it.
        const target =
          el.querySelector<HTMLElement>('.varve-dialog__body [data-autofocus]') ??
          el.querySelector<HTMLElement>(
            '.varve-dialog__body button, .varve-dialog__body [role="combobox"], .varve-dialog__body input, .varve-dialog__body [role="slider"], .varve-dialog__body [tabindex]:not([tabindex="-1"])',
          );
        target?.focus();
      }
    } else if (!open && el.open) {
      el.close();
      // Native close() restores focus to the element that was focused before
      // showModal(). When that element unmounted (a context-menu item, a row
      // that was deleted), the platform has nowhere to put focus and it
      // lands on <body>. Surfaces that own a stable hierarchy mark it with
      // `data-dialog-focus-fallback`; focus there instead of stranding the
      // user at the top of the document.
      const ownerDocument = el.ownerDocument;
      const active = ownerDocument.activeElement;
      if (!active || active === ownerDocument.body) {
        ownerDocument.querySelector<HTMLElement>('[data-dialog-focus-fallback]')?.focus();
      }
    }
  }, [open, focusFirstControl]);

  const handleRef = useCallback(
    (el: HTMLDialogElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  // Consumer handlers are composed with the internal dismissal behavior
  // rather than spread over it. Spreading `...rest` after these props let a
  // caller-supplied onCancel/onClick/onKeyDown silently remove Escape or
  // backdrop dismissal (and the nested-overlay guard) from a modal dialog.
  const handleCancel = useCallback(
    (e: React.SyntheticEvent<HTMLDialogElement>) => {
      if (consumerOptedOut(e, consumerOnCancel)) return;
      e.preventDefault();
      if (dismissible) onClose();
    },
    [dismissible, onClose, consumerOnCancel],
  );

  const handleBackdropPointerDown = useCallback((e: React.PointerEvent<HTMLDialogElement>) => {
    backdropPressRef.current = { down: e.target === innerRef.current, up: false };
  }, []);

  const handleBackdropPointerUp = useCallback((e: React.PointerEvent<HTMLDialogElement>) => {
    backdropPressRef.current.up = e.target === innerRef.current;
  }, []);

  const handleBackdropPointerCancel = useCallback(() => {
    backdropPressRef.current = CLEARED_PRESS;
  }, []);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (consumerOptedOut(e, consumerOnClick)) return;
      const press = backdropPressRef.current;
      backdropPressRef.current = CLEARED_PRESS;
      if (dismissible && e.target === innerRef.current && press.down && press.up) onClose();
    },
    [dismissible, onClose, consumerOnClick],
  );

  const nestedOverlays = useNestedOverlayRegistry();

  const handleBackdropKey = useCallback(
    (e: React.KeyboardEvent<HTMLDialogElement>) => {
      if (consumerOptedOut(e, consumerOnKeyDown)) return;
      if (dismissible && e.key === 'Escape') {
        // Don't close the dialog when a nested overlay (Select, Popover,
        // etc.) is open — that overlay should consume the Escape first.
        if (nestedOverlays.hasOpenOverlayRef.current) return;
        onClose();
      }
    },
    [dismissible, onClose, nestedOverlays, consumerOnKeyDown],
  );

  return (
    <NestedOverlayProvider registry={nestedOverlays}>
      <dialog
        ref={handleRef}
        aria-labelledby={titleId}
        onCancel={handleCancel}
        onPointerDown={handleBackdropPointerDown}
        onPointerUp={handleBackdropPointerUp}
        onPointerCancel={handleBackdropPointerCancel}
        onClick={handleBackdrop}
        onKeyDown={handleBackdropKey}
        className={`varve-dialog${size !== 'sm' ? ` varve-dialog--${size}` : ''} ${className}`.trim()}
        {...rest}
      >
        <div className="varve-dialog__header">
          <h2 id={titleId} className="varve-dialog__title">
            {title}
          </h2>
          <button
            type="button"
            className="varve-dialog__close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="varve-dialog__body">{open ? children : null}</div>
        {footer != null && <div className="varve-dialog__footer">{footer}</div>}
      </dialog>
    </NestedOverlayProvider>
  );
});

export interface AlertDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
}

export function AlertDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
}: AlertDialogProps) {
  const descriptionId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      // N4/U16 (2026-08-10): confirmation dialogs must not dismiss on
      // backdrop click — an accidental tap could discard a destructive
      // confirmation. Esc still cancels via the handler below.
      dismissible={false}
      // Focus the least destructive action, not the header Close button or
      // the confirm action: APG's alertdialog guidance, and it prevents an
      // immediate Enter from destroying data.
      focusFirstControl
      role="alertdialog"
      aria-describedby={descriptionId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <p id={descriptionId} className="varve-dialog__desc">
        {description}
      </p>
      <div className="varve-dialog__actions">
        <Button variant="ghost" onClick={onClose} data-autofocus>
          {cancelLabel}
        </Button>
        <Button
          variant={variant}
          onClick={() => {
            try {
              onConfirm();
            } finally {
              onClose();
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

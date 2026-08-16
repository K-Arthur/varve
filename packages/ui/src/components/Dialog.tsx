import {
  type DialogHTMLAttributes,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from 'react';
import { useNestedOverlayRef } from './NestedOverlayContext';

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

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      if (focusFirstControl) {
        const target = el.querySelector<HTMLElement>(
          '.varve-dialog__body [data-autofocus], .varve-dialog__body button, .varve-dialog__body [role="combobox"], .varve-dialog__body input, .varve-dialog__body [role="slider"], .varve-dialog__body [tabindex]:not([tabindex="-1"])',
        );
        target?.focus();
      }
    } else if (!open && el.open) {
      el.close();
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

  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (consumerOptedOut(e, consumerOnClick)) return;
      if (dismissible && e.target === innerRef.current) onClose();
    },
    [dismissible, onClose, consumerOnClick],
  );

  const nestedOverlayRef = useNestedOverlayRef();

  const handleBackdropKey = useCallback(
    (e: React.KeyboardEvent<HTMLDialogElement>) => {
      if (consumerOptedOut(e, consumerOnKeyDown)) return;
      if (dismissible && e.key === 'Escape') {
        // Don't close the dialog when a nested overlay (Select, Popover,
        // etc.) is open — that overlay should consume the Escape first.
        if (nestedOverlayRef.current) return;
        onClose();
      }
    },
    [dismissible, onClose, nestedOverlayRef, consumerOnKeyDown],
  );

  return (
    <dialog
      ref={handleRef}
      aria-labelledby={titleId}
      onCancel={handleCancel}
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
  variant?: 'danger' | 'primary';
}

export function AlertDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
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
        <button type="button" className="varve-btn varve-btn--ghost" onClick={onClose}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`varve-btn varve-btn--${variant}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

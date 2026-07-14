import {
  type DialogHTMLAttributes,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from 'react';

export interface DialogProps extends DialogHTMLAttributes<HTMLDialogElement> {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** When true, clicking the backdrop dismisses the dialog. */
  dismissible?: boolean;
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  { open, onClose, title, children, dismissible = true, className = '', ...rest },
  ref,
) {
  const innerRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const handleRef = useCallback(
    (el: HTMLDialogElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  const handleCancel = useCallback(
    (e: React.SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault();
      if (dismissible) onClose();
    },
    [dismissible, onClose],
  );

  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (dismissible && e.target === innerRef.current) onClose();
    },
    [dismissible, onClose],
  );

  const handleBackdropKey = useCallback(
    (e: React.KeyboardEvent<HTMLDialogElement>) => {
      if (dismissible && e.key === 'Escape') onClose();
    },
    [dismissible, onClose],
  );

  return (
    <dialog
      ref={handleRef}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onClick={handleBackdrop}
      onKeyDown={handleBackdropKey}
      className={`strata-dialog ${className}`.trim()}
      {...rest}
    >
      <div className="strata-dialog__header">
        <h2 id={titleId} className="strata-dialog__title">
          {title}
        </h2>
        <button
          type="button"
          className="strata-dialog__close"
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
      <div className="strata-dialog__body">{open ? children : null}</div>
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
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      dismissible
      role="alertdialog"
      aria-describedby="alert-desc"
    >
      <p id="alert-desc" className="strata-dialog__desc">
        {description}
      </p>
      <div className="strata-dialog__actions">
        <button type="button" className="strata-btn strata-btn--ghost" onClick={onClose}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`strata-btn strata-btn--${variant}`}
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

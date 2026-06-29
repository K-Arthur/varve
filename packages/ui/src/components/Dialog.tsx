import {
  type DialogHTMLAttributes,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
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

  return (
    <dialog
      ref={handleRef}
      aria-labelledby="dialog-title"
      onCancel={handleCancel}
      onClick={handleBackdrop}
      className={`strata-dialog ${className}`.trim()}
      {...rest}
    >
      <div className="strata-dialog__header">
        <h2 id="dialog-title" className="strata-dialog__title">
          {title}
        </h2>
        <button
          type="button"
          className="strata-dialog__close"
          aria-label="Close dialog"
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      <div className="strata-dialog__body">{children}</div>
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

import {
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { SemanticIcon, type SemanticIconName } from '../icons';
import { Spinner } from './Spinner';

export type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'error' | 'loading';

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
  /** Dismiss the notification after the action succeeds. Defaults to true. */
  dismiss?: boolean;
}

export interface ToastItem {
  id: string;
  message: string;
  title?: string;
  description?: string;
  /** `type` is retained as the concise application-facing spelling. */
  type?: ToastVariant;
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
  cancelAction?: ToastAction;
  dismissible?: boolean;
  /** Stable key used to update an in-flight operation instead of stacking it. */
  dedupeKey?: string;
  /** Optional count for aggregated batch feedback. */
  count?: number;
  /** Merge repeated events with the same dedupeKey into a count summary. */
  aggregate?: boolean;
  /** Internal revision used to reset lifecycle timers after an update. */
  updatedAt?: number;
}

export type ToastInput = Omit<ToastItem, 'id' | 'updatedAt'> & { id?: string };

export interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function getVariant(toast: ToastItem): ToastVariant {
  return toast.variant ?? toast.type ?? 'default';
}

function getDefaultDuration(variant: ToastVariant): number | undefined {
  switch (variant) {
    case 'loading':
      // Direct loading calls receive a finite safety window. Long-running
      // work belongs in a task surface; promise callers normally settle well
      // before this watchdog expires.
      return 120_000;
    case 'error':
      return undefined;
    case 'warning':
      return 8000;
    case 'info':
      return 6000;
    case 'success':
      return 4000;
    default:
      return 5000;
  }
}

const ICONS: Record<Exclude<ToastVariant, 'default' | 'loading'>, SemanticIconName> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const variant = getVariant(toast);
  const duration = toast.duration ?? getDefaultDuration(variant);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(duration);
  const startTimeRef = useRef(0);
  const exitingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    clearTimer();
    setExiting(true);
    exitTimerRef.current = setTimeout(() => onDismiss(toast.id), 150);
  }, [clearTimer, toast.id, onDismiss]);

  const startTimer = useCallback(() => {
    const remaining = remainingRef.current;
    if (remaining === undefined) return;
    clearTimer();
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(dismiss, remaining);
  }, [clearTimer, dismiss]);

  // An update represents a new lifecycle state. Reset its timer from the new
  // semantic duration, which is essential for loading -> success/error.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt is an intentional lifecycle revision trigger
  useEffect(() => {
    remainingRef.current = duration;
    startTimeRef.current = 0;
    if (!exitingRef.current) startTimer();
    return clearTimer;
  }, [clearTimer, duration, startTimer, toast.updatedAt]);

  const pauseTimer = useCallback(() => {
    if (remainingRef.current === undefined) return;
    if (startTimeRef.current !== 0) {
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      startTimeRef.current = 0;
    }
    clearTimer();
  }, [clearTimer]);

  const resumeTimer = useCallback(() => {
    if (!exitingRef.current && remainingRef.current !== undefined && remainingRef.current > 0) {
      startTimer();
    }
  }, [startTimer]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') pauseTimer();
      else resumeTimer();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimer();
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    };
  }, [clearTimer, pauseTimer, resumeTimer]);

  const handleFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) pauseTimer();
    },
    [pauseTimer],
  );

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) resumeTimer();
    },
    [resumeTimer],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    },
    [dismiss],
  );

  const handleAction = useCallback(
    async (action: ToastAction) => {
      await action.onClick();
      if (action.dismiss !== false) dismiss();
    },
    [dismiss],
  );

  const icon =
    variant === 'loading' ? (
      <Spinner size="sm" className="varve-toast__icon" />
    ) : variant === 'default' ? null : (
      <SemanticIcon name={ICONS[variant]} size="sm" className="varve-toast__icon" />
    );
  const typeClass = variant === 'default' ? '' : ` varve-toast--${variant}`;
  const message =
    toast.count && toast.count > 1 ? `${toast.message} (${toast.count})` : toast.message;
  const content =
    toast.title || toast.description ? (
      <div className="varve-toast__copy">
        {toast.title && <strong className="varve-toast__title">{toast.title}</strong>}
        {toast.description && <span className="varve-toast__description">{toast.description}</span>}
        {toast.message && <span className="varve-toast__message">{message}</span>}
      </div>
    ) : (
      <span className="varve-toast__message">{message}</span>
    );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover/focus pause the notification timer
    <div
      className={`varve-toast${typeClass}${exiting ? ' varve-toast--exiting' : ''}`}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {icon}
      {content}
      {(toast.action || toast.cancelAction) && (
        <div className="varve-toast__actions">
          {toast.action && (
            <button
              type="button"
              className="varve-toast__action"
              onClick={() => void handleAction(toast.action!)}
            >
              {toast.action.label}
            </button>
          )}
          {toast.cancelAction && (
            <button
              type="button"
              className="varve-toast__action varve-toast__action--secondary"
              onClick={() => void handleAction(toast.cancelAction!)}
            >
              {toast.cancelAction.label}
            </button>
          )}
        </div>
      )}
      {toast.dismissible !== false && (
        <button
          className="varve-toast__close"
          aria-label="Dismiss notification"
          onClick={dismiss}
          type="button"
        >
          <SemanticIcon name="Close" size="sm" />
        </button>
      )}
    </div>
  );
}

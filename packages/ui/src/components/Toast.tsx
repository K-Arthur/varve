import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

export interface ToastItem {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

export interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function getDefaultDuration(type: ToastItem['type']): number | undefined {
  switch (type) {
    case 'error':
      return undefined;
    case 'warning':
      return 8000;
    default:
      return 5000;
  }
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(toast.duration ?? getDefaultDuration(toast.type));
  const startTimeRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 150);
  }, [toast.id, onDismiss]);

  const startTimer = useCallback(() => {
    const duration = remainingRef.current;
    if (duration === undefined) return;
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(dismiss, duration);
  }, [dismiss]);

  useEffect(() => {
    if (toast.type !== 'error') {
      startTimer();
    }
    return clearTimer;
  }, [toast.type, startTimer, clearTimer]);

  const pauseTimer = useCallback(() => {
    if (toast.type === 'error') return;
    if (startTimeRef.current !== 0 && remainingRef.current !== undefined) {
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    }
    clearTimer();
  }, [clearTimer, toast.type]);

  const resumeTimer = useCallback(() => {
    if (toast.type === 'error') return;
    if (remainingRef.current !== undefined && remainingRef.current > 0) {
      startTimer();
    }
  }, [startTimer, toast.type]);

  const role = toast.type === 'error' ? 'alert' : 'status';
  const typeClass = toast.type && toast.type !== 'info' ? `varve-toast--${toast.type}` : '';

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss();
      }
    },
    [dismiss],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: toast needs hover/focus to pause auto-dismiss timer
    <div
      className={`varve-toast ${typeClass}${exiting ? ' varve-toast--exiting' : ''}`}
      role={role}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocus={pauseTimer}
      onBlur={resumeTimer}
      onKeyDown={handleKeyDown}
    >
      <span className="varve-toast__message">{toast.message}</span>
      <button
        className="varve-toast__close"
        aria-label="Dismiss notification"
        onClick={dismiss}
        type="button"
      >
        &times;
      </button>
    </div>
  );
}

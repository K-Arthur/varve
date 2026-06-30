import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ToastItem } from './Toast';
import { Toast } from './Toast';

interface ToastContextValue {
  toast: (item: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 3;
let toastCounter = 0;

function generateId(): string {
  toastCounter += 1;
  return `strata-toast-${toastCounter}-${Date.now()}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const queueRef = useRef<ToastItem[]>([]);

  const addToast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const newToast: ToastItem = { ...item, id: generateId() };

    setToasts((current) => {
      if (current.length < MAX_VISIBLE) {
        return [...current, newToast];
      }
      queueRef.current = [...queueRef.current, newToast];
      return current;
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => {
      const next = current.filter((t) => t.id !== id);
      const queued = queueRef.current;
      if (queued.length > 0) {
        const nextQueued = queued[0];
        if (nextQueued) {
          queueRef.current = queued.slice(1);
          return [...next, nextQueued];
        }
      }
      return next;
    });
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="strata-toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

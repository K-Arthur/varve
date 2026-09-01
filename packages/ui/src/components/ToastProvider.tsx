import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Toast, type ToastInput, type ToastItem, type ToastVariant } from './Toast';

export interface ToastPromiseOptions<T> {
  loading: ToastInput | string;
  success: ToastInput | string | ((value: T) => ToastInput | string);
  error: ToastInput | string | ((error: unknown) => ToastInput | string);
  id?: string;
  dedupeKey?: string;
}

export interface ToastApi {
  (input: ToastInput | string): string;
  success: (input: ToastInput | string) => string;
  info: (input: ToastInput | string) => string;
  warning: (input: ToastInput | string) => string;
  error: (input: ToastInput | string) => string;
  loading: (input: ToastInput | string) => string;
  update: (id: string, input: ToastInput | string) => string;
  dismiss: (id?: string) => void;
  dismissAll: () => void;
  promise: <T>(promise: Promise<T>, options: ToastPromiseOptions<T>) => Promise<T>;
}

interface ToastContextValue {
  toast: ToastApi;
}

interface ToastStore {
  visible: ToastItem[];
  queue: ToastItem[];
}

const ToastContext = createContext<ToastContextValue | null>(null);
const MAX_VISIBLE = 3;
const MAX_EXPANDED = 10;
let toastCounter = 0;

function generateId(): string {
  toastCounter += 1;
  return `varve-toast-${toastCounter}-${Date.now()}`;
}

function normalizeInput(input: ToastInput | string, variant?: ToastVariant): ToastInput {
  return typeof input === 'string'
    ? { message: input, type: variant }
    : { ...input, type: variant ?? input.type };
}

function sameKey(item: ToastItem, input: ToastInput): boolean {
  return Boolean(input.dedupeKey && item.dedupeKey === input.dedupeKey);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<ToastStore>({ visible: [], queue: [] });
  const lastToastRef = useRef<{ message: string; time: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const upsertToast = useCallback(
    (input: ToastInput | string, forcedVariant?: ToastVariant): string => {
      const normalized = normalizeInput(input, forcedVariant);
      const now = Date.now();
      let resultId = normalized.id ?? '';

      setStore((current) => {
        const visibleIndex = normalized.id
          ? current.visible.findIndex((item) => item.id === normalized.id)
          : current.visible.findIndex((item) => sameKey(item, normalized));
        if (visibleIndex >= 0) {
          const currentItem = current.visible[visibleIndex]!;
          resultId = currentItem.id;
          const visible = [...current.visible];
          visible[visibleIndex] = {
            ...currentItem,
            ...normalized,
            id: currentItem.id,
            updatedAt: now,
          };
          return { ...current, visible };
        }

        const queuedIndex = normalized.id
          ? current.queue.findIndex((item) => item.id === normalized.id)
          : current.queue.findIndex((item) => sameKey(item, normalized));
        if (queuedIndex >= 0) {
          const queued = [...current.queue];
          const queuedItem = queued[queuedIndex]!;
          resultId = queuedItem.id;
          queued[queuedIndex] = { ...queuedItem, ...normalized, id: queuedItem.id, updatedAt: now };
          return { ...current, queue: queued };
        }

        const last = lastToastRef.current;
        if (
          !normalized.id &&
          !normalized.dedupeKey &&
          last &&
          last.message === normalized.message &&
          now - last.time < 500
        ) {
          resultId = last.message;
          return current;
        }
        lastToastRef.current = { message: normalized.message, time: now };

        const newToast: ToastItem = {
          ...normalized,
          id: normalized.id ?? generateId(),
          updatedAt: now,
        };
        resultId = newToast.id;
        if (current.visible.length < MAX_VISIBLE)
          return { ...current, visible: [...current.visible, newToast] };
        return { ...current, queue: [...current.queue, newToast] };
      });

      return resultId || generateId();
    },
    [],
  );

  const dismissToast = useCallback((id?: string) => {
    if (!id) {
      setStore({ visible: [], queue: [] });
      setExpanded(false);
      return;
    }
    setStore((current) => {
      const visible = current.visible.filter((item) => item.id !== id);
      const queue = current.queue.filter((item) => item.id !== id);
      if (visible.length === current.visible.length) return { ...current, queue };
      const next = queue.shift();
      return { visible: next ? [...visible, next] : visible, queue };
    });
  }, []);

  const updateToast = useCallback(
    (id: string, input: ToastInput | string) => upsertToast({ ...normalizeInput(input), id }),
    [upsertToast],
  );

  const promiseToast = useCallback(
    <T,>(promise: Promise<T>, options: ToastPromiseOptions<T>) => {
      const id = options.id ?? options.dedupeKey ?? generateId();
      upsertToast({
        ...normalizeInput(options.loading, 'loading'),
        id,
        dedupeKey: options.dedupeKey,
      });
      return promise.then(
        (value) => {
          const next =
            typeof options.success === 'function' ? options.success(value) : options.success;
          updateToast(id, normalizeInput(next));
          return value;
        },
        (error: unknown) => {
          const next = typeof options.error === 'function' ? options.error(error) : options.error;
          updateToast(id, normalizeInput(next, 'error'));
          throw error;
        },
      );
    },
    [updateToast, upsertToast],
  );

  const toast = useMemo<ToastApi>(() => {
    const api = ((input: ToastInput | string) => upsertToast(input)) as ToastApi;
    api.success = (input) => upsertToast(input, 'success');
    api.info = (input) => upsertToast(input, 'info');
    api.warning = (input) => upsertToast(input, 'warning');
    api.error = (input) => upsertToast(input, 'error');
    api.loading = (input) => upsertToast(input, 'loading');
    api.update = updateToast;
    api.dismiss = dismissToast;
    api.dismissAll = () => dismissToast();
    api.promise = promiseToast;
    return api;
  }, [dismissToast, promiseToast, updateToast, upsertToast]);

  const renderedToasts = expanded
    ? [...store.visible, ...store.queue].slice(0, MAX_EXPANDED)
    : store.visible;
  const overflowCount = Math.max(
    0,
    store.queue.length - (expanded ? MAX_EXPANDED - store.visible.length : 0),
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className={`varve-toast-container${expanded ? ' varve-toast-container--expanded' : ''}`}>
        <div className="varve-toast-stack">
          {renderedToasts.map((item) => (
            <Toast key={item.id} toast={item} onDismiss={dismissToast} />
          ))}
          {store.queue.length > 0 && (
            <button
              type="button"
              className="varve-toast__overflow"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? 'Show fewer notifications'
                : `Show ${store.queue.length} more notification${store.queue.length === 1 ? '' : 's'}`}
              {overflowCount > 0 && expanded ? ` (${overflowCount} queued)` : ''}
            </button>
          )}
        </div>
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

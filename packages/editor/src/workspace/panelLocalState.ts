/**
 * Bounded presentation state shared with a panel's transfer lifecycle.
 *
 * This is deliberately window-local and contains only presentation choices
 * (selected tab, filter, preview size, and similar). It is neither editor
 * state nor a second document store. The generic panel lifecycle reads it in
 * the primary host and restores it in the auxiliary host after hydration.
 */

import { useCallback, useEffect, useState } from 'react';

type PanelState = Record<string, unknown>;
type PanelStateListener = (value: unknown) => void;
type StateUpdate<T> = T | ((current: T) => T);

const states = new Map<string, PanelState>();
const listeners = new Map<string, Map<string, Set<PanelStateListener>>>();

function listenerSet(panelTypeId: string, key: string): Set<PanelStateListener> {
  let panelListeners = listeners.get(panelTypeId);
  if (!panelListeners) {
    panelListeners = new Map();
    listeners.set(panelTypeId, panelListeners);
  }
  let keyListeners = panelListeners.get(key);
  if (!keyListeners) {
    keyListeners = new Set();
    panelListeners.set(key, keyListeners);
  }
  return keyListeners;
}

function isSerializable(value: unknown, seen = new WeakSet<object>(), depth = 0): boolean {
  if (depth > 24 || value === undefined) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.length <= 1_000 && value.every((item) => isSerializable(item, seen, depth + 1));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 1_000 &&
    entries.every(
      ([key, item]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        key.length <= 128 &&
        isSerializable(item, seen, depth + 1),
    )
  );
}

/** Read a current presentation value without creating a subscription. */
export function getPanelLocalState<T>(panelTypeId: string, key: string): T | undefined {
  return states.get(panelTypeId)?.[key] as T | undefined;
}

/**
 * Return the bounded JSON-safe state for a panel transfer. A JSON round trip
 * removes accidental mutable references and declines state that cannot cross
 * the serializable broker boundary.
 */
export function capturePanelLocalState(panelTypeId: string): PanelState | undefined {
  const state = states.get(panelTypeId);
  if (!state || !isSerializable(state)) return undefined;
  try {
    return JSON.parse(JSON.stringify(state)) as PanelState;
  } catch {
    return undefined;
  }
}

/** Publish restored presentation state and notify mounted panel controls. */
export function restorePanelLocalState(panelTypeId: string, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isSerializable(value)) return;
  const next = value as PanelState;
  states.set(panelTypeId, { ...next });
  const panelListeners = listeners.get(panelTypeId);
  if (!panelListeners) return;
  for (const [key, callbacks] of panelListeners) {
    if (!Object.hasOwn(next, key)) continue;
    for (const callback of callbacks) callback(next[key]);
  }
}

function publishPanelLocalState(panelTypeId: string, key: string, value: unknown): void {
  if (!isSerializable(value)) return;
  states.set(panelTypeId, { ...states.get(panelTypeId), [key]: value });
  for (const callback of listenerSet(panelTypeId, key)) callback(value);
}

/**
 * React state whose value is automatically available to the panel transfer
 * lifecycle. Restoration also updates an already-mounted auxiliary panel,
 * which is necessary because hydration acknowledgement occurs after mount.
 */
export function usePanelLocalState<T>(
  panelTypeId: string,
  key: string,
  initialValue: T | (() => T),
): [T, (update: StateUpdate<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    const restored = getPanelLocalState<T>(panelTypeId, key);
    return restored === undefined
      ? typeof initialValue === 'function'
        ? (initialValue as () => T)()
        : initialValue
      : restored;
  });

  useEffect(() => {
    const callbacks = listenerSet(panelTypeId, key);
    const receive = (next: unknown) => setValue(next as T);
    callbacks.add(receive);
    return () => {
      callbacks.delete(receive);
      if (callbacks.size === 0) listeners.get(panelTypeId)?.delete(key);
      if (listeners.get(panelTypeId)?.size === 0) listeners.delete(panelTypeId);
    };
  }, [key, panelTypeId]);

  useEffect(() => {
    publishPanelLocalState(panelTypeId, key, value);
  }, [key, panelTypeId, value]);

  const setTrackedValue = useCallback(
    (update: StateUpdate<T>) => {
      setValue((current) => {
        const next = typeof update === 'function' ? (update as (current: T) => T)(current) : update;
        publishPanelLocalState(panelTypeId, key, next);
        return next;
      });
    },
    [key, panelTypeId],
  );

  return [value, setTrackedValue];
}

/** Test-only cleanup for independent panel-state scenarios. */
export function resetPanelLocalStateForTest(): void {
  states.clear();
  listeners.clear();
}

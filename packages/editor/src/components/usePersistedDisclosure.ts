/**
 * usePersistedDisclosure — remembers a sidebar section's collapsed state
 * across remounts and sessions.
 *
 * The Inspector sections persist through the registry-backed
 * `EditorState.sectionVisibility`; the left sidebar sections (variables,
 * masters, pages, design canvases, spreads) historically used per-mount React
 * state, so collapsing a section was silently forgotten on every workspace
 * switch, panel toggle, and reload. Editor users report that class of reset as
 * the most disruptive panel behavior (Blender #123653 "#141506", Godot
 * #81481): the workspace re-orders itself under the user's hands.
 *
 * Storage is localStorage, namespaced, read once on mount and written on
 * change. Every access is guarded: private mode, disabled storage, and quota
 * failures fall back to the in-memory value rather than throwing.
 */
import { useCallback, useState } from 'react';

export const DISCLOSURE_STORAGE_PREFIX = 'varve:disclosure:';

function readStored(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(DISCLOSURE_STORAGE_PREFIX + key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // Storage unavailable (private mode / sandbox) — keep the default.
  }
  return fallback;
}

function writeStored(key: string, collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISCLOSURE_STORAGE_PREFIX + key, collapsed ? '1' : '0');
  } catch {
    // Storage unavailable or full — the session still behaves consistently.
  }
}

export type PersistedDisclosureSetter = (next: boolean | ((current: boolean) => boolean)) => void;

export function usePersistedDisclosure(
  key: string,
  defaultCollapsed = false,
): [collapsed: boolean, setCollapsed: PersistedDisclosureSetter] {
  const [collapsed, setCollapsedState] = useState(() => readStored(key, defaultCollapsed));

  const setCollapsed = useCallback<PersistedDisclosureSetter>(
    (next) => {
      setCollapsedState((current) => {
        const value = typeof next === 'function' ? next(current) : next;
        writeStored(key, value);
        return value;
      });
    },
    [key],
  );

  return [collapsed, setCollapsed];
}

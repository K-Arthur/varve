/**
 * Reduced-motion manager — single source of truth for prefers-reduced-motion.
 *
 * All viewport animations (smoothZoomTo, smoothPanTo, smoothReveal), timeline
 * playback, and prototype transitions read preference state from this module
 * instead of duplicating window.matchMedia checks.
 *
 * Supports:
 * - Runtime preference changes without reload (matchMedia listener)
 * - Explicit application override via setOverride()
 * - React hook (useReducedMotion) for component re-render on change
 * - Non-React subscribe/unsubscribe for RAF-driven code
 */
import { useEffect, useState } from 'react';

let mql: MediaQueryList | null = null;
let reduced = false;
let listeners: Set<(reduced: boolean) => void> = new Set();
let override: boolean | null = null;

function ensureMql(): void {
  if (typeof window === 'undefined') return;
  if (mql) return;
  mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = mql.matches;
  mql.addEventListener('change', onChange);
}

function onChange(ev: MediaQueryListEvent): void {
  reduced = ev.matches;
  const effective = override ?? reduced;
  for (const fn of listeners) fn(effective);
}

/** Live value of the effective reduced-motion flag (override wins if set). */
export function isReducedMotion(): boolean {
  if (override !== null) return override;
  if (typeof window === 'undefined') return false;
  ensureMql();
  return reduced;
}

/**
 * Override the reduced-motion preference at the application level.
 * Pass `null` to clear the override and return to the OS/media-query value.
 */
export function setReducedMotionOverride(value: boolean | null): void {
  override = value;
  const effective = override ?? (mql ? mql.matches : false);
  for (const fn of listeners) fn(effective);
}

/** Subscribe to changes. Returns unsubscribe function. */
export function subscribeReducedMotion(fn: (reduced: boolean) => void): () => void {
  ensureMql();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Unsubscribe (kept for symmetry, prefer the returned function from subscribe). */
export function unsubscribeReducedMotion(fn: (reduced: boolean) => void): void {
  listeners.delete(fn);
}

/** @internal — reset singleton state for testing. */
export function __resetReducedMotion(): void {
  if (mql) {
    mql.removeEventListener('change', onChange);
  }
  mql = null;
  reduced = false;
  listeners = new Set();
  override = null;
}

/**
 * React hook — triggers re-render when the preference changes.
 * Returns the effective reduced-motion value (override wins if set).
 */
export function useReducedMotion(): boolean {
  const [rm, setRm] = useState(isReducedMotion);
  useEffect(() => subscribeReducedMotion(setRm), []);
  return rm;
}

/**
 * Manages contextual micro-hint display.
 *
 * Shows a brief hint the first time the user selects a tool, with a
 * cooldown between hints. Respects learning preferences and reduced motion.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';
import { toolShortcutLabel } from '../../shortcuts/toolShortcutLabel';
import {
  dismissMicroHint,
  hasSeenMicroHint,
  loadOnboardingState,
  saveOnboardingState,
} from '../onboardingStore';
import { getHintForTool, getMultiSelectHint, type MicroHint } from './microHintsData';

const HINT_COOLDOWN_MS = 30_000;
const MAX_HINTS_PER_SESSION = 3;

/** Tools that should never trigger a micro-hint. */
const SKIP_TOOLS = new Set(['select', 'hand', 'zoom']);

interface UseMicroHintsOptions {
  toolId: string;
  workspaceMode?: WorkspaceMode;
  enabled: boolean;
  selectionCount: number;
  /** When true, append the canonical tool shortcut to tool hints. */
  shortcutsEnabled?: boolean;
}

export function useMicroHints({
  toolId,
  enabled,
  selectionCount,
  shortcutsEnabled = false,
}: UseMicroHintsOptions): {
  currentHint: MicroHint | null;
  dismiss: () => void;
} {
  const [currentHint, setCurrentHint] = useState<MicroHint | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHintTimeRef = useRef<number>(0);
  const sessionHintCountRef = useRef(0);
  const lastToolRef = useRef<string>('');
  const lastSelectionCountRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }, []);

  // Resolve the canonical shortcut for a tool id (single source of truth — the
  // shortcut registry). Returns undefined when no key is bound.
  const resolveShortcut = useCallback(
    (id: string): string | undefined => {
      if (!shortcutsEnabled) return undefined;
      return toolShortcutLabel(id as never);
    },
    [shortcutsEnabled],
  );

  const dismiss = useCallback(() => {
    clearTimer();
    if (currentHint) {
      const state = loadOnboardingState();
      saveOnboardingState(dismissMicroHint(state, currentHint.id));
    }
    setCurrentHint(null);
    lastHintTimeRef.current = Date.now();
  }, [clearTimer, currentHint]);

  // Tool change: show hint if first use and eligible
  useEffect(() => {
    if (!enabled) return;
    if (toolId === lastToolRef.current) return;
    lastToolRef.current = toolId;

    if (SKIP_TOOLS.has(toolId)) return;
    if (sessionHintCountRef.current >= MAX_HINTS_PER_SESSION) return;

    const now = Date.now();
    if (now - lastHintTimeRef.current < HINT_COOLDOWN_MS) return;

    const hint = getHintForTool(toolId);
    if (!hint) return;

    const state = loadOnboardingState();
    if (hasSeenMicroHint(state, hint.id)) return;

    setCurrentHint({ ...hint, shortcut: resolveShortcut(toolId) });
    sessionHintCountRef.current++;
    lastHintTimeRef.current = now;

    if (hint.duration > 0) {
      clearTimer();
      hintTimerRef.current = setTimeout(() => {
        setCurrentHint(null);
      }, hint.duration);
    }
  }, [toolId, enabled, clearTimer, resolveShortcut]);

  // Multi-select hint
  useEffect(() => {
    if (!enabled) return;
    if (selectionCount < 2) {
      lastSelectionCountRef.current = selectionCount;
      return;
    }
    if (lastSelectionCountRef.current >= 2) {
      lastSelectionCountRef.current = selectionCount;
      return;
    }
    lastSelectionCountRef.current = selectionCount;

    if (sessionHintCountRef.current >= MAX_HINTS_PER_SESSION) return;

    const now = Date.now();
    if (now - lastHintTimeRef.current < HINT_COOLDOWN_MS) return;

    const hint = getMultiSelectHint();
    const state = loadOnboardingState();
    if (hasSeenMicroHint(state, hint.id)) return;

    setCurrentHint({ ...hint, shortcut: undefined });
    sessionHintCountRef.current++;
    lastHintTimeRef.current = now;

    if (hint.duration > 0) {
      clearTimer();
      hintTimerRef.current = setTimeout(() => {
        setCurrentHint(null);
      }, hint.duration);
    }
  }, [selectionCount, enabled, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { currentHint, dismiss };
}

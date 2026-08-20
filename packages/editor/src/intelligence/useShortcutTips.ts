import { useCallback, useEffect, useRef, useState } from 'react';
import { suppressedTipShortcutIds } from '../workspace/workspaceShortcutLabel';
import type { WorkspaceConfig, WorkspaceMode } from '../workspace/workspaceTypes';
import { getActionTracker } from './actionTracker';
import { recommendShortcuts, type ShortcutRecommendation } from './shortcutRecommender';

const DISMISSED_KEY = 'strata:dismissed-tips';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_DISMISS_MS = 10_000;

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(dismissed: Set<string>): void {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
}

export interface UseShortcutTipsResult {
  currentTip: ShortcutRecommendation | null;
  dismiss: () => void;
}

export function useShortcutTips(
  workspaceMode: WorkspaceMode,
  showTipsEnabled: boolean,
  effectiveWorkspaceConfig?: WorkspaceConfig,
): UseShortcutTipsResult {
  const [currentTip, setCurrentTip] = useState<ShortcutRecommendation | null>(null);
  const shownThisSessionRef = useRef(false);
  const dismissedRef = useRef<Set<string>>(loadDismissed());
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackerRef = useRef(getActionTracker());

  const clearAutoDismiss = useCallback(() => {
    if (autoDismissTimerRef.current !== null) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearAutoDismiss();
    const tip = currentTip;
    if (tip) {
      dismissedRef.current.add(tip.shortcutId);
      saveDismissed(dismissedRef.current);
    }
    setCurrentTip(null);
  }, [currentTip, clearAutoDismiss]);

  const poll = useCallback(() => {
    if (!showTipsEnabled) return;
    if (shownThisSessionRef.current) return;

    const [top] = recommendShortcuts(
      trackerRef.current,
      1,
      suppressedTipShortcutIds(workspaceMode, effectiveWorkspaceConfig),
    );

    if (!top) return;
    if (dismissedRef.current.has(top.shortcutId)) return;

    shownThisSessionRef.current = true;
    setCurrentTip(top);
  }, [workspaceMode, showTipsEnabled, effectiveWorkspaceConfig]);

  useEffect(() => {
    clearAutoDismiss();
    if (currentTip) {
      autoDismissTimerRef.current = setTimeout(() => {
        setCurrentTip(null);
      }, AUTO_DISMISS_MS);
    }
    return () => clearAutoDismiss();
  }, [currentTip, clearAutoDismiss]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      clearAutoDismiss();
    };
  }, [poll, clearAutoDismiss]);

  return { currentTip, dismiss };
}

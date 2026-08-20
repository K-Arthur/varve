import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';
import { dismissTip, loadOnboardingState, saveOnboardingState } from '../onboardingStore';
import { TIPS, type Tip } from './tips';
import { workspaceTips } from './workspaceTips';

const TIPS_TODAY_KEY = 'strata:tips-today';
const IDLE_THRESHOLD_MS = 15000;
const MAX_TIPS_PER_DAY = 5;
/**
 * After a tip is dismissed (manually or by auto-timeout) we stay quiet for
 * this long before surfacing another. This enforces the "one interruption at
 * a time" rule: dismissing a tip must not immediately queue a different one.
 */
const DISMISS_COOLDOWN_MS = 120000;

interface TipsTodayData {
  count: number;
  date: string;
  shownIds: string[];
}

function loadTipsToday(): TipsTodayData {
  try {
    const stored = localStorage.getItem(TIPS_TODAY_KEY);
    if (!stored) return { count: 0, date: '', shownIds: [] };
    const parsed = JSON.parse(stored) as TipsTodayData;
    const today = new Date().toDateString();
    if (parsed.date !== today) {
      return { count: 0, date: today, shownIds: [] };
    }
    return parsed;
  } catch {
    return { count: 0, date: '', shownIds: [] };
  }
}

function saveTipsToday(data: TipsTodayData): void {
  localStorage.setItem(TIPS_TODAY_KEY, JSON.stringify(data));
}

export interface DidYouKnowOptions {
  /** Master switch for contextual tips (Settings → Learning → Contextual tips). */
  enabled?: boolean;
  /**
   * When false, proactive workspace/first-use tutorial suggestions are
   * suppressed (Settings → Learning → Tutorial suggestions). General tips
   * still respect `enabled`.
   */
  suggestTutorials?: boolean;
}

export function useDidYouKnow(
  tracker: { getCount: (id: string, windowMs?: number) => number },
  /** Active workspace — surfaces that workspace's declared onboarding tips. */
  mode?: WorkspaceMode,
  options: DidYouKnowOptions = {},
): {
  currentTip: Tip | null;
  dismiss: () => void;
  dontShowAgain: () => void;
} {
  const { enabled = true, suggestTutorials = true } = options;
  const [currentTip, setCurrentTip] = useState<Tip | null>(null);
  const queueRef = useRef<Tip[]>([]);
  // The queue is built once and drained. A workspace switch changes which
  // tips are eligible, so a queue built for the previous workspace must be
  // discarded — otherwise Design's tips keep arriving after switching to
  // Print, and Print's tips never surface at all.
  const modeRef = useRef<WorkspaceMode | undefined>(mode);
  if (modeRef.current !== mode) {
    modeRef.current = mode;
    queueRef.current = [];
  }
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  // When non-zero, suppress the next tip until this timestamp. Set whenever a
  // tip is dismissed so we never immediately swap one tip for another.
  const cooldownRef = useRef<number>(0);

  // Track user activity to reset idle timer
  useEffect(() => {
    if (!enabled) return;

    function handleActivity() {
      lastActivityRef.current = Date.now();

      // Reset idle timer if we had one running
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }

      // Don't start idle timer if a tip is already showing
      if (currentTip) return;

      idleTimerRef.current = setTimeout(() => {
        checkAndShowNext();
      }, IDLE_THRESHOLD_MS);
    }

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('scroll', handleActivity, { passive: true });
    window.addEventListener('touchstart', handleActivity, { passive: true });

    // Start initial idle timer
    idleTimerRef.current = setTimeout(() => {
      checkAndShowNext();
    }, IDLE_THRESHOLD_MS);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    };
  }, [currentTip, enabled]);

  function checkAndShowNext() {
    if (!enabled) return;
    // Respect the post-dismissal cooldown so a dismissal is not immediately
    // followed by a different tip (one interruption at a time).
    if (Date.now() < cooldownRef.current) return;

    // Check daily limit
    const tipsToday = loadTipsToday();
    if (tipsToday.count >= MAX_TIPS_PER_DAY) {
      return;
    }

    // Load dismissed tips
    const state = loadOnboardingState();
    const dismissed = new Set(state.dismissedTips);

    // Build queue of eligible tips not already dismissed. The active
    // workspace's own tips lead: they are the most specific advice available
    // for what the user is doing right now. Proactive workspace/tutorial
    // suggestions are gated by `suggestTutorials`.
    if (queueRef.current.length === 0) {
      const active = modeRef.current;
      const candidates = [
        ...(suggestTutorials && active ? workspaceTips(active) : []),
        ...TIPS,
      ];
      queueRef.current = candidates.filter((tip) => {
        if (dismissed.has(tip.id)) return false;
        if (tipsToday.shownIds.includes(tip.id)) return false;
        if (tip.condition && !tip.condition(tracker.getCount.bind(tracker))) return false;
        return true;
      });
    }

    if (queueRef.current.length === 0) return;

    const nextTip = queueRef.current.shift()!;

    // Update tips-today counter
    const updated: TipsTodayData = {
      count: tipsToday.count + 1,
      date: new Date().toDateString(),
      shownIds: [...tipsToday.shownIds, nextTip.id],
    };
    saveTipsToday(updated);

    setCurrentTip(nextTip);
  }

  const dismiss = useCallback(() => {
    setCurrentTip(null);
    lastActivityRef.current = Date.now();
    // Stay quiet before the next tip — dismissing must not queue another.
    cooldownRef.current = Date.now() + DISMISS_COOLDOWN_MS;

    // Start idle timer to show next tip (gated by the cooldown in checkAndShowNext)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      checkAndShowNext();
    }, IDLE_THRESHOLD_MS);
  }, []);

  const dontShowAgain = useCallback(() => {
    if (currentTip) {
      const state = loadOnboardingState();
      const updated = dismissTip(state, currentTip.id);
      saveOnboardingState(updated);
    }
    setCurrentTip(null);
    lastActivityRef.current = Date.now();
    cooldownRef.current = Date.now() + DISMISS_COOLDOWN_MS;
  }, [currentTip]);

  return { currentTip, dismiss, dontShowAgain };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';
import { dismissTip, loadOnboardingState, saveOnboardingState } from '../onboardingStore';
import { TIPS, type Tip } from './tips';
import { workspaceTips } from './workspaceTips';

const TIPS_TODAY_KEY = 'strata:tips-today';
const IDLE_THRESHOLD_MS = 15000;
const MAX_TIPS_PER_DAY = 5;

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

export function useDidYouKnow(
  tracker: { getCount: (id: string, windowMs?: number) => number },
  /** Active workspace — surfaces that workspace's declared onboarding tips. */
  mode?: WorkspaceMode,
): {
  currentTip: Tip | null;
  dismiss: () => void;
  dontShowAgain: () => void;
} {
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

  // Track user activity to reset idle timer
  useEffect(() => {
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
  }, [currentTip]);

  function checkAndShowNext() {
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
    // for what the user is doing right now.
    if (queueRef.current.length === 0) {
      const active = modeRef.current;
      const candidates = active ? [...workspaceTips(active), ...TIPS] : TIPS;
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

    // Start idle timer to show next tip
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
  }, [currentTip]);

  return { currentTip, dismiss, dontShowAgain };
}

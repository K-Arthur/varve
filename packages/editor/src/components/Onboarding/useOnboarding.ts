import type { Platform } from '@varve/platform';
import { useCallback, useEffect, useState } from 'react';
import {
  dismissTip as dismissTipStore,
  loadOnboardingState,
  loadOnboardingStateFromPlatform,
  markOnboardingComplete,
  type OnboardingStore,
  saveOnboardingState,
} from '../../onboard/onboardingStore';
import { TOUR_STEPS } from './tourSteps';

export interface OnboardingState {
  active: boolean;
  stepIndex: number;
  showWelcome: boolean;
}

export interface OnboardingActions {
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  dismiss: () => void;
  isComplete: () => boolean;
  reopen: () => void;
  resetWelcome: () => void;
  requestWelcome: () => void;
  dismissTip: (tipId: string) => void;
}

export function useOnboarding(platform?: Platform): OnboardingState & OnboardingActions {
  const [state, setState] = useState<OnboardingState>(() => {
    // Nothing is shown automatically. The Welcome dialog, tour, and checklist
    // are all opt-in (Help menu / Settings). This keeps first launch
    // non-blocking — the user can create and edit immediately.
    return {
      active: false,
      stepIndex: -1,
      showWelcome: false,
    };
  });

  // Hydrate durable onboarding state from platform storage (SQLite on
  // desktop, IndexedDB on web). Merges into localStorage when platform has
  // richer state — e.g. checklist progress surviving a WebView localStorage wipe.
  useEffect(() => {
    if (!platform) return;
    let cancelled = false;
    loadOnboardingStateFromPlatform(platform).then((saved) => {
      if (cancelled || !saved) return;
      const local = loadOnboardingState();
      const merged: OnboardingStore = {
        ...local,
        ...saved,
        checklistProgress:
          saved.checklistProgress.length >= local.checklistProgress.length
            ? saved.checklistProgress
            : local.checklistProgress,
        dismissedTips: [...new Set([...local.dismissedTips, ...saved.dismissedTips])],
        seenFeatureBadges: [...new Set([...local.seenFeatureBadges, ...saved.seenFeatureBadges])],
      };
      saveOnboardingState(merged, platform);
      if (merged.onboardingComplete) {
        setState({ active: false, stepIndex: -1, showWelcome: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const complete = useCallback(() => {
    const saved = loadOnboardingState();
    const updated = markOnboardingComplete(saved);
    saveOnboardingState(updated, platform);
    setState({ active: false, stepIndex: -1, showWelcome: false });
  }, [platform]);

  const startTour = useCallback(() => {
    setState({ active: true, stepIndex: 0, showWelcome: false });
  }, []);

  const nextStep = useCallback(() => {
    setState((s) => {
      const next = s.stepIndex + 1;
      if (next >= TOUR_STEPS.length) {
        complete();
        return s;
      }
      return { ...s, stepIndex: next, showWelcome: false };
    });
  }, [complete]);

  const prevStep = useCallback(() => {
    setState((s) => ({
      ...s,
      stepIndex: Math.max(0, s.stepIndex - 1),
      showWelcome: false,
    }));
  }, []);

  const dismiss = useCallback(() => {
    complete();
  }, [complete]);

  const isComplete = useCallback(() => {
    const saved = loadOnboardingState();
    return saved.onboardingComplete;
  }, []);

  const reopen = useCallback(() => {
    setState({ active: true, stepIndex: 0, showWelcome: false });
  }, []);

  const resetWelcome = useCallback(() => {
    setState({ active: true, stepIndex: -1, showWelcome: true });
  }, []);

  const requestWelcome = useCallback(() => {
    setState({ active: true, stepIndex: -1, showWelcome: true });
  }, []);

  const dismissTip = useCallback(
    (tipId: string) => {
      const saved = loadOnboardingState();
      const updated = dismissTipStore(saved, tipId);
      saveOnboardingState(updated, platform);
    },
    [platform],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!state.active || state.showWelcome) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextStep();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevStep();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.active, state.showWelcome, dismiss, nextStep, prevStep]);

  return {
    ...state,
    startTour,
    nextStep,
    prevStep,
    dismiss,
    isComplete,
    reopen,
    resetWelcome,
    requestWelcome,
    dismissTip,
  };
}

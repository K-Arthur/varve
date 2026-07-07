import type { Platform } from '@strata/platform';
import { useCallback, useEffect, useState } from 'react';
import {
  dismissTip as dismissTipStore,
  loadOnboardingState,
  loadOnboardingStateFromPlatform,
  markOnboardingComplete,
  saveOnboardingState,
  saveOnboardingStateToPlatform,
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
  dismissTip: (tipId: string) => void;
}

export function useOnboarding(platform?: Platform): OnboardingState & OnboardingActions {
  const [state, setState] = useState<OnboardingState>(() => {
    const saved = loadOnboardingState();
    return {
      active: !saved.onboardingComplete,
      stepIndex: -1,
      showWelcome: !saved.onboardingComplete,
    };
  });

  // localStorage is read synchronously above for a fast first paint, but on
  // desktop it isn't guaranteed to survive between separate app launches
  // (see the comment on loadOnboardingStateFromPlatform). Correct the
  // optimistic localStorage-derived guess against native platform storage
  // once it resolves, so a returning user doesn't see the welcome dialog
  // again just because the WebView's localStorage was reset.
  useEffect(() => {
    if (!platform) return;
    let cancelled = false;
    loadOnboardingStateFromPlatform(platform).then((saved) => {
      if (cancelled || !saved?.onboardingComplete) return;
      setState({ active: false, stepIndex: -1, showWelcome: false });
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const complete = useCallback(() => {
    const saved = loadOnboardingState();
    const updated = markOnboardingComplete(saved);
    saveOnboardingState(updated);
    if (platform) saveOnboardingStateToPlatform(platform, updated);
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

  const dismissTip = useCallback((tipId: string) => {
    const saved = loadOnboardingState();
    const updated = dismissTipStore(saved, tipId);
    saveOnboardingState(updated);
  }, []);

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
    dismissTip,
  };
}

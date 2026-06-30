import { useCallback, useEffect, useState } from 'react';
import { TOUR_STEPS } from './tourSteps';

const STORAGE_KEY = 'strata-onboarding-complete';

export interface OnboardingState {
  /** Whether the onboarding dialog/overlay is visible. */
  active: boolean;
  /** Current tour step index (-1 = welcome screen shown). */
  stepIndex: number;
  /** Whether the welcome screen is shown. */
  showWelcome: boolean;
}

export interface OnboardingActions {
  /** Start the onboarding tour from the welcome screen. */
  startTour: () => void;
  /** Go to the next tour step. */
  nextStep: () => void;
  /** Go to the previous tour step. */
  prevStep: () => void;
  /** Skip/dismiss the entire onboarding. */
  dismiss: () => void;
  /** Check if onboarding is complete. */
  isComplete: () => boolean;
  /** Reopen the onboarding (for Help menu). */
  reopen: () => void;
}

export function useOnboarding(): OnboardingState & OnboardingActions {
  const [state, setState] = useState<OnboardingState>(() => {
    const completed = localStorage.getItem(STORAGE_KEY) === 'true';
    return {
      active: !completed,
      stepIndex: -1,
      showWelcome: !completed,
    };
  });

  const complete = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setState({ active: false, stepIndex: -1, showWelcome: false });
  }, []);

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
    return localStorage.getItem(STORAGE_KEY) === 'true';
  }, []);

  const reopen = useCallback(() => {
    setState({ active: true, stepIndex: 0, showWelcome: false });
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
  };
}

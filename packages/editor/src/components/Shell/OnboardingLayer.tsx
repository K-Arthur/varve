import type { Platform } from '@varve/platform';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useEditor } from '../../context';
import { getActionTracker } from '../../intelligence/actionTracker';
import {
  checkChecklistItem,
  DidYouKnowTip,
  loadOnboardingState,
  markTutorialComplete,
  saveOnboardingState,
  TutorialBanner,
  useDidYouKnow,
  useTutorialProgress,
} from '../../onboard';
import {
  CHECKLIST_ITEMS,
  OnboardingChecklist,
} from '../../onboard/OnboardingChecklist/OnboardingChecklist';
import { createTutorialDocument } from '../../samples/tutorial-document';
import { SpotlightOverlay, useOnboarding, WelcomeDialog } from '../Onboarding';
import { TOUR_STEPS } from '../Onboarding/tourSteps';

export interface OnboardingLayerHandle {
  reopen: () => void;
}

export interface OnboardingLayerProps {
  platform?: Platform;
  onBackToHome?: () => void;
}

export const OnboardingLayer = forwardRef<OnboardingLayerHandle, OnboardingLayerProps>(
  function OnboardingLayer({ platform, onBackToHome }, ref) {
    const editor = useEditor();
    const tutorialProgress = useTutorialProgress(editor.state.document);
    const onboarding = useOnboarding(editor.platform);

    useImperativeHandle(ref, () => ({
      reopen: onboarding.reopen,
    }));

    const [checklistOpen, setChecklistOpen] = useState(false);
    const [checklistProgress, setChecklistProgressState] = useState<string[]>(() => {
      const saved = loadOnboardingState();
      return saved.checklistProgress;
    });

    const updateChecklistProgress = useCallback(
      (itemId: string) => {
        setChecklistProgressState((prev) => {
          if (prev.includes(itemId)) return prev;
          const updated = [...prev, itemId];
          const saved = loadOnboardingState();
          saveOnboardingState(checkChecklistItem(saved, itemId), platform);
          return updated;
        });
      },
      [platform],
    );

    const dismissChecklist = useCallback(() => {
      setChecklistOpen(false);
    }, []);

    useEffect(() => {
      const tracker = getActionTracker();
      if (tracker.getCount('op:createNode', 300_000) > 0) updateChecklistProgress('shape');
      if (tracker.getCount('menu:fill', 300_000) > 0) updateChecklistProgress('color');
      if (tracker.getCount('tool:text', 300_000) > 0) updateChecklistProgress('text');
      if (
        tracker.getCount('shortcut:group', 600_000) > 0 ||
        tracker.getCount('tool:select', 600_000) > 0
      ) {
        const saved = loadOnboardingState();
        if (
          saved.checklistProgress.includes('shape') &&
          saved.checklistProgress.includes('color')
        ) {
          updateChecklistProgress('group');
        }
      }
      if (tracker.getCount('export', 600_000) > 0) updateChecklistProgress('export');
    }, [updateChecklistProgress, platform]);

    useEffect(() => {
      if (!onboarding.showWelcome && !onboarding.active) {
        const saved = loadOnboardingState();
        const allDone = CHECKLIST_ITEMS.every((item) => saved.checklistProgress.includes(item.id));
        if (!saved.onboardingComplete || !allDone) {
          setChecklistOpen(true);
        }
      }
    }, [onboarding.showWelcome, onboarding.active]);

    const {
      currentTip: didYouKnowTip,
      dismiss: dismissTip,
      dontShowAgain: dontShowAgainTip,
    } = useDidYouKnow(getActionTracker(), editor.state.workspaceMode);

    const currentStep = onboarding.stepIndex >= 0 && onboarding.active ? onboarding.stepIndex : -1;

    return (
      <>
        {/* Tutorial banner */}
        <TutorialBanner
          progress={tutorialProgress}
          onComplete={() => {
            const state = loadOnboardingState();
            saveOnboardingState(markTutorialComplete(state));
          }}
        />

        {/* Welcome dialog */}
        <WelcomeDialog
          open={onboarding.showWelcome && onboarding.active}
          onStartTour={onboarding.startTour}
          onStartTutorial={() => {
            const tutorialDoc = createTutorialDocument();
            editor.updateDoc(() => tutorialDoc);
            onboarding.dismiss();
          }}
          onStartBlank={() => {
            onboarding.dismiss();
          }}
          onStartTemplate={() => {
            onboarding.dismiss();
            onBackToHome?.();
          }}
          onClose={onboarding.dismiss}
        />

        {/* Spotlight tour overlay */}
        {currentStep >= 0 &&
          onboarding.active &&
          (() => {
            const step = TOUR_STEPS[currentStep];
            if (!step) return null;
            return (
              <SpotlightOverlay
                stepIndex={currentStep}
                totalSteps={TOUR_STEPS.length}
                step={step}
                onNext={onboarding.nextStep}
                onPrev={onboarding.prevStep}
                onDismiss={onboarding.dismiss}
              />
            );
          })()}

        {/* Onboarding checklist */}
        <OnboardingChecklist
          open={checklistOpen}
          onClose={() => setChecklistOpen(false)}
          progress={checklistProgress}
          onItemClick={(id) => updateChecklistProgress(id)}
          onDismiss={dismissChecklist}
        />

        {/* Did You Know? contextual tips */}
        {didYouKnowTip && (
          <DidYouKnowTip
            tip={didYouKnowTip}
            onDismiss={dismissTip}
            onDontShowAgain={dontShowAgainTip}
          />
        )}
      </>
    );
  },
);

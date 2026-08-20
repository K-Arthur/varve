import type { Platform } from '@varve/platform';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useEditor } from '../../context';
import { getActionTracker } from '../../intelligence/actionTracker';
import {
  checkChecklistItem,
  DidYouKnowTip,
  loadOnboardingState,
  MicroHint,
  markTutorialComplete,
  saveOnboardingState,
  TutorialBanner,
  useDidYouKnow,
  useMicroHints,
  useTutorialProgress,
} from '../../onboard';
import { OnboardingChecklist } from '../../onboard/OnboardingChecklist/OnboardingChecklist';
import { createTutorialDocument } from '../../samples/tutorial-document';
import { SpotlightOverlay, useOnboarding, WelcomeDialog } from '../Onboarding';
import { TOUR_STEPS } from '../Onboarding/tourSteps';
import { useSettings } from '../Settings/SettingsContext';

export interface OnboardingLayerHandle {
  /** Replay the spotlight tour on demand (Help → Take a Tour). */
  reopen: () => void;
  /** Open the non-blocking "Getting started" checklist panel. */
  openChecklist: () => void;
  /** Show the Welcome dialog on demand (Help → Getting Started). */
  openWelcome: () => void;
}

export interface OnboardingLayerProps {
  platform?: Platform;
  onBackToHome?: () => void;
}

export const OnboardingLayer = forwardRef<OnboardingLayerHandle, OnboardingLayerProps>(
  function OnboardingLayer({ platform, onBackToHome }, ref) {
    const editor = useEditor();
    const { settings } = useSettings();
    const learning = settings.learning;
    const tutorialProgress = useTutorialProgress(editor.state.document);
    const onboarding = useOnboarding(editor.platform);

    useImperativeHandle(ref, () => ({
      reopen: onboarding.reopen,
      openChecklist: () => setChecklistOpen(true),
      openWelcome: () => onboarding.requestWelcome(),
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

    // Nothing is surfaced automatically. The Welcome dialog, spotlight tour,
    // and checklist are all opt-in (Help menu / Settings). This keeps first
    // launch non-blocking and respects the user's learning preferences.
    const {
      currentTip: didYouKnowTip,
      dismiss: dismissTip,
      dontShowAgain: dontShowAgainTip,
    } = useDidYouKnow(getActionTracker(), editor.state.workspaceMode, {
      enabled: learning.showContextualTips,
      suggestTutorials: learning.autoSuggestTutorials,
    });

    const selectionCount = editor.state.selection.length;
    const { currentHint: microHint, dismiss: dismissMicroHint } = useMicroHints({
      toolId: editor.state.tool,
      workspaceMode: editor.state.workspaceMode,
      enabled: learning.showContextualTips,
      selectionCount,
      shortcutsEnabled: learning.showShortcutHints,
    });

    const currentStep = onboarding.stepIndex >= 0 && onboarding.active ? onboarding.stepIndex : -1;

    // One interruption at a time: any higher-priority surface suppresses all
    // lower-priority proactive hints (DidYouKnow, MicroHint). Priority order:
    //   SpotlightTour > WelcomeDialog > OnboardingChecklist > DidYouKnow > MicroHint
    const tourActive = currentStep >= 0 && onboarding.active;
    const welcomeOpen = onboarding.showWelcome && onboarding.active;
    const checklistVisible = checklistOpen;
    const higherSurfaceActive = tourActive || welcomeOpen || checklistVisible;

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

        {/* Welcome dialog (modal) */}
        <WelcomeDialog
          open={welcomeOpen}
          onStartTour={onboarding.startTour}
          onStartTutorial={() => {
            // Open the tutorial in a NEW tab so the user's current document is
            // never discarded (Principle: never destroy unsaved work).
            editor.newDocument();
            editor.updateDoc(() => createTutorialDocument());
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
        {tourActive &&
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

        {/* Onboarding checklist (non-blocking panel) */}
        <OnboardingChecklist
          open={checklistVisible}
          onClose={() => setChecklistOpen(false)}
          progress={checklistProgress}
          onItemClick={(id) => updateChecklistProgress(id)}
          onDismiss={dismissChecklist}
        />

        {/* Did You Know? tips — suppressed when any higher-priority surface is active */}
        {didYouKnowTip && !higherSurfaceActive && (
          <DidYouKnowTip
            tip={didYouKnowTip}
            onDismiss={dismissTip}
            onDontShowAgain={dontShowAgainTip}
          />
        )}

        {/* Micro-hints — suppressed when DidYouKnow is showing or any higher surface */}
        {microHint && !didYouKnowTip && !higherSurfaceActive && (
          <MicroHint hint={microHint} onDismiss={dismissMicroHint} />
        )}
      </>
    );
  },
);

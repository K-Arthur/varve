/**
 * CrashCenter — app-level crash-recovery UI mount.
 *
 * Renders: the crash-recovery dialog (unknown/askEachTime consent), the
 * review-before-send dialog, and the safe-mode screen. Mounted once at the
 * top of the app (apps/desktop/src/App.tsx) so it covers both home and
 * editor, installs global error handlers, imports native emergency records,
 * and gates everything behind the versioned consent state.
 */

import { useEffect, useRef, useState } from 'react';
import { getOrCreateCrashController } from './controllerRegistry';
import type { CrashCenterController, CrashUiState } from './crashController';
import { CrashRecoveryDialog, CrashReviewDialog } from './crashDialogs';
import { SafeModeScreen } from './safeModeScreen';

export interface CrashCenterProps {
  platformKind: 'tauri' | 'web' | 'memory';
  /** Called once at boot; must return true when the previous session ended
   * uncleanly (see RecoveryManager's strata-clean-shutdown marker). */
  readUncleanShutdown: () => boolean;
  documentSchemaVersion?: number;
  isNetworkAvailable?: () => boolean;
  allowMetered?: () => boolean;
  /** Fired once the controller is booted (test hooks, integrations). */
  onControllerReady?: (controller: CrashCenterController) => void;
}

const INITIAL_STATE: CrashUiState = {
  consent: { state: 'unknown', policyVersion: 1, decidedAt: 0, appVersion: '', scope: 'both' },
  awaitingReport: null,
  reviewingReport: null,
  queuedReports: [],
  lastSentReportId: null,
  lastSendFailed: false,
  safeMode: null,
  dialogVisible: false,
};

/** Opens the editor's Privacy & Diagnostics settings section. */
export function openPrivacySettings(): void {
  window.dispatchEvent(new CustomEvent('varve:open-privacy-settings'));
}

export function CrashCenter({
  platformKind,
  readUncleanShutdown,
  documentSchemaVersion,
  isNetworkAvailable,
  allowMetered,
  onControllerReady,
}: CrashCenterProps) {
  const controllerRef = useRef<CrashCenterController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = getOrCreateCrashController({
      platformKind,
      readUncleanShutdown,
      documentSchemaVersion,
      isNetworkAvailable,
      allowMetered,
    });
  }
  const [state, setState] = useState<CrashUiState>(INITIAL_STATE);
  const onControllerReadyRef = useRef(onControllerReady);
  onControllerReadyRef.current = onControllerReady;

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return undefined;
    const unsubscribe = controller.subscribe(setState);
    void controller.boot().then(() => onControllerReadyRef.current?.(controller));
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, []);

  const safeMode = state.safeMode;
  if (safeMode) {
    return (
      <SafeModeScreen
        appVersion={safeMode.appVersion}
        onExit={() => controllerRef.current?.exitSafeMode()}
        onContinue={() => controllerRef.current?.continueInSafeMode()}
        onToggleOption={(option, value) => {
          const controller = controllerRef.current;
          if (!controller) return;
          // Safe-mode options persist through the safe-mode store; the
          // controller reads and updates the active state.
          controller.updateSafeModeOption(option, value);
        }}
      />
    );
  }

  const controller = controllerRef.current;
  return (
    <>
      <CrashRecoveryDialog
        open={state.dialogVisible}
        report={state.awaitingReport}
        consentChoice={
          state.consent.state === 'automaticAllowed'
            ? 'automaticAllowed'
            : state.consent.state === 'denied'
              ? 'denied'
              : 'askEachTime'
        }
        recoveryStatus={state.awaitingReport?.recoveryStatus ?? 'not-applicable'}
        sentReportId={state.lastSentReportId}
        sendFailed={state.lastSendFailed}
        onConsentChoiceChange={(choice) => controller?.setStandingConsent(choice)}
        onProceedToRecovery={() => controller?.proceedToRecovery()}
        onDecline={() => void controller?.declineAwaiting()}
        onReview={() => controller?.reviewAwaiting()}
        onSend={(withAutomatic) => void controller?.sendAwaiting(withAutomatic)}
        onClose={() => controller?.closeDialog()}
        onOpenSettings={openPrivacySettings}
        onCommentChange={(comment) => void controller?.updateComment(comment)}
        onContactChange={(contact) => void controller?.updateContact(contact)}
      />
      <CrashReviewDialog
        open={state.reviewingReport !== null}
        report={state.reviewingReport}
        onBack={() => controller?.closeReview()}
        onSend={() => void controller?.sendReviewing()}
        onCommentChange={(comment) => void controller?.updateComment(comment)}
        onContactChange={(contact) => void controller?.updateContact(contact)}
        onToggleAttachment={(index) => void controller?.toggleAttachment(index)}
      />
    </>
  );
}

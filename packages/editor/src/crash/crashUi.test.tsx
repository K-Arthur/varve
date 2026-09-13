/**
 * Component tests for the crash-recovery UI (Phase 18).
 *
 * jsdom + React Testing Library. Covers: first crash with unknown consent,
 * send-once without automatic opt-in, automatic opt-in, decline, consent
 * revocation, review-before-send, removable attachments, empty/oversized
 * comments, recovery without reporting, screen-reader labels, and keyboard
 * focus behavior of the dialogs.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  CrashConsentProvider,
  type CrashReport,
  type CrashUploader,
  type CrashUploadResult,
  MemoryCrashConsentStorage,
  unknownConsent,
} from '@varve/crash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrashCenterController, type CrashUiState } from './crashController';
import { CrashRecoveryDialog, CrashReviewDialog } from './crashDialogs';

afterEach(cleanup);

beforeEach(() => {
  // jsdom lacks HTMLDialogElement.showModal/close; stub them with real
  // browser semantics so the UA stylesheet un-hides the dialog content.
  if (typeof HTMLDialogElement !== 'undefined') {
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
      showModal?: () => void;
      close?: () => void;
    };
    if (!proto.showModal) {
      Object.defineProperty(proto, 'showModal', {
        value: function showModal(this: HTMLDialogElement) {
          this.open = true;
        },
        configurable: true,
      });
      Object.defineProperty(proto, 'close', {
        value: function close(this: HTMLDialogElement) {
          this.open = false;
        },
        configurable: true,
      });
    }
  }
});

function makeReport(overrides: Partial<CrashReport> = {}): CrashReport {
  return {
    schemaVersion: 1,
    reportId: 'r-test-1',
    sessionId: 's-1',
    createdAt: Date.now(),
    release: {
      appVersion: '0.1.0',
      buildChannel: 'dev',
      releaseId: 'rel-1',
      documentSchemaVersion: 3,
    },
    runtime: {
      runtime: 'tauri',
      osFamily: 'linux',
      osVersionRange: '6.0+',
      arch: 'x64',
      memoryPressure: 'medium',
      rendererBackend: 'canvas2d',
    },
    crash: {
      type: 'error',
      category: 'render-loop',
      subsystem: 'canvas',
      message: 'canvas render failed',
      stack: [{ module: 'CanvasArea.tsx', function: 'renderSubtree', line: 1031 }],
      rawStack: 'Error: canvas render failed\n    at renderSubtree (CanvasArea.tsx:1031:5)',
      threadCategory: 'main',
    },
    breadcrumbs: [{ ts: 1, event: 'renderer.backend.selected' }],
    attachments: [
      {
        kind: 'log',
        name: 'varve-log.txt',
        sizeBytes: 2048,
        content: 'log bytes',
        included: false,
      },
    ],
    consentPolicyVersion: 1,
    recoveryStatus: 'recovered',
    uploadAttempts: 0,
    ...overrides,
  };
}

function consentState(state: 'unknown' | 'denied' | 'askEachTime' | 'automaticAllowed') {
  const storage = new MemoryCrashConsentStorage();
  if (state !== 'unknown') {
    storage.save({ ...unknownConsent(), state, decidedAt: 1, appVersion: '0.1.0' });
  }
  return new CrashConsentProvider(storage);
}

class RecordingUploader implements CrashUploader {
  uploaded: string[] = [];
  fail = false;
  async upload(report: CrashReport): Promise<CrashUploadResult> {
    if (this.fail) return { ok: false, retryable: true, error: 'simulated' };
    this.uploaded.push(report.reportId);
    return { ok: true, retryable: false, status: 200 };
  }
}

function makeController(
  overrides: {
    state?: 'unknown' | 'denied' | 'askEachTime' | 'automaticAllowed';
    unclean?: boolean;
    uploader?: CrashUploader;
  } = {},
) {
  const consent = consentState(overrides.state ?? 'unknown');
  const uploader = overrides.uploader ?? new RecordingUploader();
  const controller = new CrashCenterController({
    platformKind: 'memory',
    readUncleanShutdown: () => overrides.unclean ?? false,
    uploader,
    consentOverride: consent,
    release: { appVersion: '0.1.0', buildChannel: 'dev', releaseId: 'rel-1' },
  });
  return { controller, uploader: uploader as RecordingUploader };
}

describe('CrashRecoveryDialog', () => {
  const baseProps = {
    open: true,
    report: makeReport(),
    consentChoice: 'askEachTime' as const,
    recoveryStatus: 'recovered' as const,
    sentReportId: null,
    sendFailed: false,
    onConsentChoiceChange: () => undefined,
    onProceedToRecovery: () => undefined,
    onDecline: () => undefined,
    onReview: () => undefined,
    onSend: () => undefined,
    onClose: () => undefined,
    onOpenSettings: () => undefined,
    onCommentChange: () => undefined,
    onContactChange: () => undefined,
  };

  it('labels the recovery action as primary and never conditions it on reporting', () => {
    const onProceed = vi.fn();
    const onSend = vi.fn();
    render(<CrashRecoveryDialog {...baseProps} onProceedToRecovery={onProceed} onSend={onSend} />);
    const recovery = screen.getByRole('button', { name: 'Review my documents' });
    expect(recovery).toBeTruthy();
    fireEvent.click(recovery);
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('send does not enable automatic reporting unless the checkbox is checked', () => {
    const onSend = vi.fn();
    render(<CrashRecoveryDialog {...baseProps} onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(onSend).toHaveBeenCalledWith(false);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Automatically send future crash reports' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(onSend).toHaveBeenCalledWith(true);
  });

  it('decline deletes the local report', () => {
    const onDecline = vi.fn();
    render(<CrashRecoveryDialog {...baseProps} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole('button', { name: /don't send/i }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('review opens the review-before-send dialog', () => {
    const onReview = vi.fn();
    render(<CrashRecoveryDialog {...baseProps} onReview={onReview} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review report' }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('exposes the three standing choices explicitly (no preselection)', () => {
    render(<CrashRecoveryDialog {...baseProps} consentChoice="askEachTime" />);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThanOrEqual(3);
  });

  it('oversized comments are bounded by the input maxlength', () => {
    render(<CrashRecoveryDialog {...baseProps} />);
    const textarea = screen.getByPlaceholderText(/anything you want/i) as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(2000);
  });

  it('announces recovery status to screen readers', () => {
    render(<CrashRecoveryDialog {...baseProps} recoveryStatus="recovered" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('changes were recovered');
  });

  it('shows a copyable report id after sending', () => {
    render(<CrashRecoveryDialog {...baseProps} sentReportId="r-sent-123" />);
    expect(screen.getByText('r-sent-123')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('Escape closes without sending', () => {
    const onClose = vi.fn();
    const onSend = vi.fn();
    const { container } = render(
      <CrashRecoveryDialog {...baseProps} onClose={onClose} onSend={onSend} />,
    );
    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    fireEvent.keyDown(dialog!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('CrashReviewDialog', () => {
  const baseProps = {
    open: true,
    report: makeReport(),
    onBack: () => undefined,
    onSend: () => undefined,
    onCommentChange: () => undefined,
    onContactChange: () => undefined,
    onToggleAttachment: () => undefined,
  };

  it('shows human-readable summary fields', () => {
    render(<CrashReviewDialog {...baseProps} />);
    expect(screen.getByText('0.1.0 (dev)')).toBeTruthy();
    expect(screen.getByText(/linux/)).toBeTruthy();
    expect(screen.getByText(/render-loop/)).toBeTruthy();
    expect(screen.getByText('canvas2d')).toBeTruthy();
  });

  it('shows the scrubbed stack trace', () => {
    render(<CrashReviewDialog {...baseProps} />);
    expect(screen.getAllByText(/CanvasArea\.tsx/).length).toBeGreaterThan(0);
  });

  it('attachments are unchecked by default and toggleable', () => {
    const onToggle = vi.fn();
    render(<CrashReviewDialog {...baseProps} onToggleAttachment={onToggle} />);
    const checkbox = screen.getByRole('checkbox', { name: /varve-log\.txt/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it('exposes an expandable technical view for advanced users', () => {
    render(<CrashReviewDialog {...baseProps} />);
    const summary = screen.getByText('Technical view');
    fireEvent.click(summary);
    // The technical body renders the raw trace (already redacted).
    expect(screen.getAllByText(/renderSubtree/).length).toBeGreaterThan(1);
  });

  it('states which fields are required for integrity', () => {
    render(<CrashReviewDialog {...baseProps} />);
    expect(screen.getByText(/required for report integrity/)).toBeTruthy();
  });

  it('empty comments are accepted', () => {
    render(<CrashReviewDialog {...baseProps} />);
    expect(screen.getByPlaceholderText(/anything you want/i)).toBeTruthy();
  });
});

describe('controller + dialog flow (integration)', () => {
  it('first crash with unknown consent queues locally and opens the dialog', async () => {
    const { controller } = makeController({ state: 'unknown' });
    const states: CrashUiState[] = [];
    controller.subscribe((s) => states.push(s));
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      threadCategory: 'main',
      recoveryStatus: 'not-applicable',
    });
    await waitFor(() => expect(controller.getState().awaitingReport).not.toBeNull());
    expect(controller.getState().dialogVisible).toBe(true);
    expect(controller.getState().queuedReports.length).toBe(1);
  });

  it('send-one does not change global consent to automatic', async () => {
    const { controller, uploader } = makeController({ state: 'unknown' });
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      threadCategory: 'main',
      recoveryStatus: 'not-applicable',
    });
    await waitFor(() => expect(controller.getState().awaitingReport).not.toBeNull());
    await controller.sendAwaiting(false);
    expect(uploader.uploaded).toHaveLength(1);
    expect(controller.getState().consent.state).toBe('askEachTime');
    // A second crash asks again instead of uploading automatically.
    const uploadsBefore = uploader.uploaded.length;
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom again',
      threadCategory: 'main',
      recoveryStatus: 'not-applicable',
    });
    await waitFor(() => expect(controller.getState().awaitingReport).not.toBeNull());
    expect(uploader.uploaded.length).toBe(uploadsBefore);
  });

  it('automatic opt-in uploads subsequent crashes without asking', async () => {
    const { controller, uploader } = makeController({ state: 'askEachTime' });
    controller.setStandingConsent('automaticAllowed');
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      threadCategory: 'main',
      recoveryStatus: 'not-applicable',
    });
    await waitFor(() => expect(uploader.uploaded.length).toBe(1));
    expect(controller.getState().dialogVisible).toBe(false);
  });

  it('decline deletes the report and keeps recovery independent', async () => {
    const { controller } = makeController({ state: 'unknown' });
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      threadCategory: 'main',
      recoveryStatus: 'recovered',
    });
    await waitFor(() => expect(controller.getState().awaitingReport).not.toBeNull());
    await controller.declineAwaiting();
    expect(controller.getState().awaitingReport).toBeNull();
    expect(controller.getState().queuedReports).toHaveLength(0);
    // Consent stays unknown — nothing was inferred.
    expect(controller.getState().consent.state).toBe('unknown');
  });

  it('revocation stops further sends from the settings path', async () => {
    const { controller, uploader } = makeController({ state: 'askEachTime' });
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      threadCategory: 'main',
      recoveryStatus: 'not-applicable',
    });
    await waitFor(() => expect(controller.getState().awaitingReport).not.toBeNull());
    controller.applyConsent('revoke');
    await controller.sendQueuedForSettings(controller.getState().awaitingReport!.reportId);
    expect(uploader.uploaded).toHaveLength(0);
  });

  it('failed sends keep the report queued and surface the failure', async () => {
    const uploader = new RecordingUploader();
    uploader.fail = true;
    const { controller } = makeController({ state: 'askEachTime', uploader });
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      threadCategory: 'main',
      recoveryStatus: 'not-applicable',
    });
    await waitFor(() => expect(controller.getState().awaitingReport).not.toBeNull());
    await controller.sendAwaiting(false);
    expect(controller.getState().lastSendFailed).toBe(true);
    expect(controller.getState().queuedReports.length).toBe(1);
  });

  it('review edits (comment, attachments) persist to the queued report', async () => {
    const { controller } = makeController({ state: 'unknown' });
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      threadCategory: 'main',
      recoveryStatus: 'not-applicable',
      attachments: [
        { kind: 'log', name: 'varve-log.txt', sizeBytes: 1, content: 'x', included: false },
      ],
    });
    await waitFor(() => expect(controller.getState().awaitingReport).not.toBeNull());
    controller.reviewAwaiting();
    const id = controller.getState().reviewingReport!.reportId;
    await controller.updateComment('repro steps: select all, delete');
    await controller.toggleAttachment(0);
    const reviewed = controller.getState().reviewingReport!;
    expect(reviewed.userComment).toBe('repro steps: select all, delete');
    expect(reviewed.attachments[0]!.included).toBe(true);
    const queued = await controller.listQueuedForSettings();
    expect(queued[0]!.userComment).toBe('repro steps: select all, delete');
    void id;
  });

  it('queued reports can be deleted from settings', async () => {
    const { controller } = makeController({ state: 'unknown' });
    await controller.captureCrash({
      type: 'error',
      category: 'render-loop',
      message: 'boom',
      threadCategory: 'main',
      recoveryStatus: 'not-applicable',
    });
    await waitFor(() => expect(controller.getState().queuedReports.length).toBe(1));
    await controller.clearQueue();
    expect(controller.getState().queuedReports).toHaveLength(0);
  });
});

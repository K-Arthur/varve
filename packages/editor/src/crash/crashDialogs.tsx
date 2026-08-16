/**
 * Crash recovery + review-before-send dialogs.
 *
 * Privacy UX rules honored here:
 *  - recovery is never conditioned on reporting ("Review my documents" is
 *    the primary action and only dismisses the report dialog);
 *  - "Send report" never silently enables automatic reporting (separate
 *    explicit checkbox);
 *  - report contents are disclosed before sending; optional fields and
 *    attachments are removable; required fields are labelled as such;
 *  - full keyboard navigation, native <dialog> focus trapping, aria-live
 *    status announcements, labels on every control, no color-only meaning.
 */

import type { CrashReport } from '@varve/crash';
import { CONTACTS } from '@varve/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface CrashRecoveryDialogProps {
  open: boolean;
  report: CrashReport | null;
  consentChoice: 'askEachTime' | 'automaticAllowed' | 'denied';
  recoveryStatus: 'recovered' | 'not-recovered' | 'not-applicable';
  sentReportId: string | null;
  sendFailed: boolean;
  onConsentChoiceChange: (choice: 'askEachTime' | 'automaticAllowed' | 'denied') => void;
  onProceedToRecovery: () => void;
  onDecline: () => void;
  onReview: () => void;
  onSend: (withAutomatic: boolean) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onCommentChange: (comment: string) => void;
  onContactChange: (contact: string) => void;
}

function formatCrashTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export function CrashRecoveryDialog({
  open,
  report,
  consentChoice,
  recoveryStatus,
  sentReportId,
  sendFailed,
  onConsentChoiceChange,
  onProceedToRecovery,
  onDecline,
  onReview,
  onSend,
  onClose,
  onOpenSettings,
  onCommentChange,
  onContactChange,
}: CrashRecoveryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevOpen = useRef(false);
  const [comment, setComment] = useState('');
  const [contact, setContact] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // jsdom does not implement showModal; real browsers get modal behavior.
    if (open && !prevOpen.current) {
      dialogRef.current?.showModal?.();
    } else if (!open && prevOpen.current) {
      dialogRef.current?.close?.();
    }
    prevOpen.current = open;
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  const handleCopyReportId = useCallback(() => {
    if (!sentReportId) return;
    void navigator.clipboard.writeText(sentReportId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [sentReportId]);

  if (!open) return null;

  const recovered = recoveryStatus === 'recovered';

  return (
    <dialog
      ref={dialogRef}
      className="crash-dialog"
      aria-modal="true"
      aria-labelledby="crash-dialog-title"
      onKeyDown={handleKeyDown}
      onClose={onClose}
    >
      <div role="status" aria-live="polite" className="sr-only">
        {recovered
          ? 'Varve closed unexpectedly. Your latest changes were recovered. You can recover your documents or send a crash report.'
          : 'Varve closed unexpectedly. Your latest changes could not be recovered. You can recover your documents or send a crash report.'}
      </div>

      <div className="crash-dialog__header">
        <h2 id="crash-dialog-title" className="crash-dialog__title">
          Varve closed unexpectedly
        </h2>
        <p className="crash-dialog__subtitle">
          {recovered
            ? 'Your latest changes were recovered and are ready for you.'
            : 'Your latest changes could not be recovered. Any auto-saved documents are still available.'}
        </p>
      </div>

      {sentReportId ? (
        <div className="crash-dialog__receipt">
          <p className="crash-dialog__receipt-title">Report sent</p>
          <p>Thanks — your report was sent. You can reference it in a support conversation:</p>
          <div className="crash-dialog__report-id">
            <code>{sentReportId}</code>
            <button type="button" className="crash-dialog__copy" onClick={handleCopyReportId}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="crash-dialog__settings-link">
            <button type="button" className="crash-dialog__link" onClick={onOpenSettings}>
              Privacy and diagnostics settings
            </button>
          </p>
          <div className="crash-dialog__footer">
            <button
              type="button"
              className="crash-dialog__btn crash-dialog__btn--primary"
              onClick={onProceedToRecovery}
            >
              Review my documents
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="crash-dialog__section">
            <h3 className="crash-dialog__section-title">What a crash report can contain</h3>
            <ul className="crash-dialog__list">
              <li>App version, operating system, and crash type</li>
              <li>A scrubbed technical trace (no file paths, names, or document content)</li>
              <li>Recent technical events, such as which subsystem failed</li>
            </ul>
            {report && (
              <p className="crash-dialog__meta">
                Crash from {formatCrashTime(report.createdAt)} · {report.crash.category} ·{' '}
                {report.runtime.osFamily} {report.runtime.osVersionRange ?? ''}
              </p>
            )}
          </div>

          <div className="crash-dialog__section">
            <label className="crash-dialog__field">
              <span className="crash-dialog__field-label">Comments (optional)</span>
              <textarea
                className="crash-dialog__textarea"
                rows={2}
                maxLength={2000}
                placeholder="Anything you want the developer to know"
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  onCommentChange(e.target.value);
                }}
              />
            </label>
            <label className="crash-dialog__field">
              <span className="crash-dialog__field-label">Contact (optional)</span>
              <input
                type="email"
                className="crash-dialog__input"
                maxLength={200}
                placeholder="Email address so we can reply"
                value={contact}
                onChange={(e) => {
                  setContact(e.target.value);
                  onContactChange(e.target.value);
                }}
              />
            </label>
          </div>

          <div
            className="crash-dialog__section"
            role="radiogroup"
            aria-label="Crash reporting choice"
          >
            <h3 className="crash-dialog__section-title">Crash reporting</h3>
            <label className="crash-dialog__radio">
              <input
                type="radio"
                name="crash-consent"
                checked={consentChoice === 'askEachTime'}
                onChange={() => onConsentChoiceChange('askEachTime')}
              />
              <span>Ask me before sending each crash report</span>
            </label>
            <label className="crash-dialog__radio">
              <input
                type="radio"
                name="crash-consent"
                checked={consentChoice === 'automaticAllowed'}
                onChange={() => onConsentChoiceChange('automaticAllowed')}
              />
              <span>Automatically send minimized crash reports</span>
            </label>
            <label className="crash-dialog__radio">
              <input
                type="radio"
                name="crash-consent"
                checked={consentChoice === 'denied'}
                onChange={() => onConsentChoiceChange('denied')}
              />
              <span>Never send crash reports</span>
            </label>
          </div>

          <div className="crash-dialog__section">
            <label className="crash-dialog__checkbox">
              <input
                type="checkbox"
                checked={automatic}
                onChange={(e) => setAutomatic(e.target.checked)}
              />
              <span>Automatically send future crash reports</span>
            </label>
          </div>

          {sendFailed && (
            <>
              <p role="alert" className="crash-dialog__error">
                The report could not be sent. It is still saved locally — try again, or delete it
                from Privacy and diagnostics settings.
              </p>
              <p className="crash-dialog__settings-link">
                Need help without sending diagnostics?{' '}
                <a href={`mailto:${CONTACTS.support}`}>{CONTACTS.support}</a>
              </p>
            </>
          )}

          <div className="crash-dialog__footer">
            <button
              type="button"
              className="crash-dialog__btn crash-dialog__btn--primary"
              onClick={onProceedToRecovery}
            >
              Review my documents
            </button>
            <button type="button" className="crash-dialog__btn" onClick={onDecline}>
              Don&apos;t send
            </button>
            <button
              type="button"
              className="crash-dialog__btn crash-dialog__btn--secondary"
              onClick={onReview}
            >
              Review report
            </button>
            <button
              type="button"
              className="crash-dialog__btn crash-dialog__btn--send"
              onClick={() => onSend(automatic)}
            >
              Send report
            </button>
          </div>
          <p className="crash-dialog__settings-link">
            <button type="button" className="crash-dialog__link" onClick={onOpenSettings}>
              Privacy and diagnostics settings
            </button>
          </p>
        </>
      )}
    </dialog>
  );
}

export interface CrashReviewDialogProps {
  open: boolean;
  report: CrashReport | null;
  onBack: () => void;
  onSend: () => void;
  onCommentChange: (comment: string) => void;
  onContactChange: (contact: string) => void;
  onToggleAttachment: (index: number) => void;
}

function renderStack(report: CrashReport): string {
  const lines = report.crash.stack.map((frame) => {
    const func = frame.function ? `${frame.function} ` : '';
    const loc = frame.line ? `:${frame.line}${frame.column ? `:${frame.column}` : ''}` : '';
    return `    ${func}(${frame.module}${loc})`;
  });
  return lines.join('\n');
}

export function CrashReviewDialog({
  open,
  report,
  onBack,
  onSend,
  onCommentChange,
  onContactChange,
  onToggleAttachment,
}: CrashReviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevOpen = useRef(false);
  const [techOpen, setTechOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [contact, setContact] = useState('');

  useEffect(() => {
    // jsdom does not implement showModal; real browsers get modal behavior.
    if (open && !prevOpen.current) {
      dialogRef.current?.showModal?.();
    } else if (!open && prevOpen.current) {
      dialogRef.current?.close?.();
    }
    prevOpen.current = open;
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    },
    [onBack],
  );

  if (!open || !report) return null;

  return (
    <dialog
      ref={dialogRef}
      className="crash-dialog crash-dialog--review"
      aria-modal="true"
      aria-labelledby="crash-review-title"
      onKeyDown={handleKeyDown}
    >
      <div className="crash-dialog__header">
        <h2 id="crash-review-title" className="crash-dialog__title">
          Review crash report
        </h2>
        <p className="crash-dialog__subtitle">
          Everything below is scrubbed of file paths, names, and document content before it is
          stored. You can remove optional details before sending.
        </p>
      </div>

      <div className="crash-dialog__review">
        <dl className="crash-dialog__review-list">
          <div className="crash-dialog__review-row">
            <dt>Application version</dt>
            <dd>
              {report.release.appVersion} ({report.release.buildChannel})
            </dd>
          </div>
          <div className="crash-dialog__review-row">
            <dt>Operating system</dt>
            <dd>
              {report.runtime.osFamily} {report.runtime.osVersionRange ?? ''} ·{' '}
              {report.runtime.arch}
            </dd>
          </div>
          <div className="crash-dialog__review-row">
            <dt>Runtime</dt>
            <dd>{report.runtime.runtime}</dd>
          </div>
          <div className="crash-dialog__review-row">
            <dt>Crash category</dt>
            <dd>
              {report.crash.category}
              {report.crash.subsystem ? ` · ${report.crash.subsystem}` : ''}
            </dd>
          </div>
          <div className="crash-dialog__review-row">
            <dt>Renderer</dt>
            <dd>{report.runtime.rendererBackend}</dd>
          </div>
          <div className="crash-dialog__review-row">
            <dt>Memory pressure</dt>
            <dd>{report.runtime.memoryPressure}</dd>
          </div>
          <div className="crash-dialog__review-row">
            <dt>Message</dt>
            <dd className="crash-dialog__review-message">{report.crash.message}</dd>
          </div>
        </dl>

        <div className="crash-dialog__review-section">
          <h3 className="crash-dialog__section-title">Stack trace (scrubbed)</h3>
          <pre className="crash-dialog__stack">
            {report.crash.stack.length > 0 ? renderStack(report) : 'No stack frames captured.'}
          </pre>
        </div>

        {report.breadcrumbs.length > 0 && (
          <div className="crash-dialog__review-section">
            <h3 className="crash-dialog__section-title">Recent diagnostic events</h3>
            <ul className="crash-dialog__crumbs">
              {report.breadcrumbs.map((crumb) => (
                <li key={`${crumb.ts}-${crumb.event}`}>{crumb.event}</li>
              ))}
            </ul>
          </div>
        )}

        {report.attachments.length > 0 && (
          <div className="crash-dialog__review-section">
            <h3 className="crash-dialog__section-title">Attachments</h3>
            <p className="crash-dialog__hint">
              Nothing is attached by default. Select what to include.
            </p>
            <ul className="crash-dialog__attachments">
              {report.attachments.map((attachment, index) => (
                <li key={attachment.name} className="crash-dialog__attachment">
                  <label className="crash-dialog__checkbox">
                    <input
                      type="checkbox"
                      checked={attachment.included}
                      onChange={() => onToggleAttachment(index)}
                    />
                    <span>
                      {attachment.name} ({attachment.sizeBytes} bytes)
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="crash-dialog__review-section">
          <label className="crash-dialog__field">
            <span className="crash-dialog__field-label">Comments (optional)</span>
            <textarea
              className="crash-dialog__textarea"
              rows={2}
              maxLength={2000}
              placeholder="Anything you want the developer to know"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                onCommentChange(e.target.value);
              }}
            />
          </label>
          <label className="crash-dialog__field">
            <span className="crash-dialog__field-label">Contact (optional)</span>
            <input
              type="email"
              className="crash-dialog__input"
              maxLength={200}
              value={contact}
              onChange={(e) => {
                setContact(e.target.value);
                onContactChange(e.target.value);
              }}
            />
          </label>
        </div>

        <details
          className="crash-dialog__tech"
          open={techOpen}
          onToggle={(e) => setTechOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="crash-dialog__tech-summary">Technical view</summary>
          <pre className="crash-dialog__tech-body">
            {report.crash.rawStack ?? renderStack(report)}
          </pre>
        </details>

        <p className="crash-dialog__required-note">
          Version, operating system, crash category, and the scrubbed trace are required for report
          integrity and cannot be removed. They contain no document content.
        </p>
      </div>

      <div className="crash-dialog__footer">
        <button
          type="button"
          className="crash-dialog__btn crash-dialog__btn--secondary"
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="crash-dialog__btn crash-dialog__btn--send"
          onClick={onSend}
        >
          Send report
        </button>
      </div>
    </dialog>
  );
}

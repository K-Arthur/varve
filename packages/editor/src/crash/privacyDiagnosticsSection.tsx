/**
 * Privacy & Diagnostics settings section.
 *
 * The single place to review and manage crash-reporting consent, queued
 * reports, extended-diagnostics opt-ins, and local support bundles. Every
 * control here is explicit; nothing is pre-selected on the user's behalf.
 */

import type { CrashReport } from '@varve/crash';
import type { AnalyticsConsentState } from '@varve/shared';
import { Select } from '@varve/ui';
import { useEffect, useMemo, useState } from 'react';
import { updateDesktopAnalyticsConsent } from '../analytics/desktopAnalytics';
import { ContactLink } from '../components/ContactLink';
import { useSettings } from '../components/Settings/SettingsContext';
import { getCrashController } from './controllerRegistry';

type ConsentChoice = 'askEachTime' | 'automaticAllowed' | 'denied';

export function PrivacyDiagnosticsSection() {
  const { settings, updateSettings } = useSettings();
  const controller = getCrashController();
  const [consent, setConsent] = useState(controller?.getState().consent);
  const [queued, setQueued] = useState<CrashReport[]>([]);
  const [extended, setExtended] = useState(false);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [bundleUrl, setBundleUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!controller) return undefined;
    const unsubscribe = controller.subscribe((state) => {
      setConsent(state.consent);
      setQueued(state.queuedReports);
    });
    void controller.listQueuedForSettings().then(setQueued);
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    try {
      setExtended(localStorage.getItem('varve:crash-extended') === '1');
      setIncludeLogs(localStorage.getItem('varve:crash-include-logs') === '1');
    } catch {
      // storage unavailable
    }
  }, []);

  const choice: ConsentChoice =
    consent?.state === 'automaticAllowed'
      ? 'automaticAllowed'
      : consent?.state === 'denied'
        ? 'denied'
        : 'askEachTime';

  const setChoice = (next: ConsentChoice) => {
    controller?.setStandingConsent(next);
  };

  const setAnalyticsConsent = (category: 'usageAnalytics' | 'diagnostics', value: string) => {
    if (value !== 'unknown' && value !== 'granted' && value !== 'denied') return;
    const privacy = { ...settings.privacy, [category]: value as AnalyticsConsentState };
    updateSettings({ privacy });
    updateDesktopAnalyticsConsent(privacy);
  };

  const setExtendedFlag = (value: boolean) => {
    setExtended(value);
    try {
      if (value) localStorage.setItem('varve:crash-extended', '1');
      else localStorage.removeItem('varve:crash-extended');
    } catch {
      // ignore
    }
  };

  const setIncludeLogsFlag = (value: boolean) => {
    setIncludeLogs(value);
    try {
      if (value) localStorage.setItem('varve:crash-include-logs', '1');
      else localStorage.removeItem('varve:crash-include-logs');
    } catch {
      // ignore
    }
  };

  const handleExport = async () => {
    if (!controller) return;
    setError(null);
    try {
      const bundle = await controller.exportSupportBundle();
      const blob = new Blob([bundle], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      setBundleUrl(url);
    } catch {
      setError('Could not build the support bundle.');
    }
  };

  const consentDescription = useMemo(() => {
    switch (consent?.state) {
      case 'automaticAllowed':
        return 'Automatic minimized reports are enabled. You can revoke this at any time.';
      case 'denied':
        return 'Crash reporting is off. You can change this at any time.';
      case 'managedDisabled':
        return 'Crash reporting is disabled by this build.';
      case 'unavailable':
        return 'Crash reporting is not supported in this environment.';
      default:
        return 'No decision recorded yet — nothing is sent until you choose.';
    }
  }, [consent]);

  return (
    <div className="privacy-section">
      <h3 className="settings-section__title">Product usage analytics</h3>
      <p className="privacy-section__description">
        Optional aggregate feature-usage statistics help prioritize Varve development. They never
        include designs, filenames, paths, text, images, or document data. This build has no
        configured usage endpoint, so enabling this preference does not send a network request.
      </p>
      <div className="settings-field-row">
        <span className="settings-field-row__label">Usage analytics</span>
        <div className="settings-field-row__control">
          <Select
            label="Usage analytics consent"
            options={[
              { value: 'unknown', label: 'Not decided (off)' },
              { value: 'granted', label: 'On' },
              { value: 'denied', label: 'Off' },
            ]}
            value={settings.privacy.usageAnalytics}
            onChange={(value) => setAnalyticsConsent('usageAnalytics', value)}
          />
        </div>
      </div>

      <h3 className="settings-section__title">Performance diagnostics</h3>
      <p className="privacy-section__description">
        Optional coarse performance and renderer-fallback measurements. Values are sent only as
        buckets and are controlled independently from usage analytics.
      </p>
      <div className="settings-field-row">
        <span className="settings-field-row__label">Diagnostics telemetry</span>
        <div className="settings-field-row__control">
          <Select
            label="Diagnostics telemetry consent"
            options={[
              { value: 'unknown', label: 'Not decided (off)' },
              { value: 'granted', label: 'On' },
              { value: 'denied', label: 'Off' },
            ]}
            value={settings.privacy.diagnostics}
            onChange={(value) => setAnalyticsConsent('diagnostics', value)}
          />
        </div>
      </div>

      <h3 className="settings-section__title">Crash reporting</h3>
      <p className="privacy-section__description">{consentDescription}</p>

      <div
        role="radiogroup"
        aria-label="Crash reporting choice"
        className="privacy-section__choices"
      >
        <label className="settings-checkbox-row">
          <input
            type="radio"
            name="privacy-consent"
            checked={choice === 'askEachTime'}
            onChange={() => setChoice('askEachTime')}
          />
          <span>Ask me before sending each crash report</span>
        </label>
        <label className="settings-checkbox-row">
          <input
            type="radio"
            name="privacy-consent"
            checked={choice === 'automaticAllowed'}
            onChange={() => setChoice('automaticAllowed')}
          />
          <span>Automatically send minimized crash reports</span>
        </label>
        <label className="settings-checkbox-row">
          <input
            type="radio"
            name="privacy-consent"
            checked={choice === 'denied'}
            onChange={() => setChoice('denied')}
          />
          <span>Never send crash reports</span>
        </label>
      </div>

      <h3 className="settings-section__title">Extended diagnostics</h3>
      <p className="privacy-section__description">
        Extended diagnostics include extra technical detail (raw scrubbed traces, subsystem
        reasons). This is separate from automatic reporting and only applies to reports you choose
        to send.
      </p>
      <label className="settings-checkbox-row">
        <input
          type="checkbox"
          checked={extended}
          onChange={(e) => setExtendedFlag(e.target.checked)}
        />
        <span>Include extended diagnostic context</span>
      </label>
      <label className="settings-checkbox-row">
        <input
          type="checkbox"
          checked={includeLogs}
          onChange={(e) => setIncludeLogsFlag(e.target.checked)}
        />
        <span>Include sanitized local logs (still requires your choice per report)</span>
      </label>

      <h3 className="settings-section__title">Queued reports</h3>
      <p className="privacy-section__description">
        Reports are stored locally, scrubbed, and expire automatically after 30 days. Nothing is
        sent without your choice.
      </p>
      {queued.length === 0 ? (
        <p className="privacy-section__empty">No queued reports.</p>
      ) : (
        <ul className="privacy-section__queue">
          {queued.map((report) => (
            <li key={report.reportId} className="privacy-section__queue-item">
              <span className="privacy-section__queue-meta">
                {new Date(report.createdAt).toLocaleString()} · {report.crash.category} ·{' '}
                {report.crash.message.length > 60
                  ? `${report.crash.message.slice(0, 60)}\u2026`
                  : report.crash.message}
              </span>
              <span className="privacy-section__queue-actions">
                <button
                  type="button"
                  className="privacy-section__btn"
                  disabled={consent?.state === 'denied'}
                  onClick={() => void controller?.sendQueuedForSettings(report.reportId)}
                >
                  Send now
                </button>
                <button
                  type="button"
                  className="privacy-section__btn"
                  onClick={() => void controller?.deleteQueued(report.reportId)}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {queued.length > 0 && (
        <button
          type="button"
          className="privacy-section__btn privacy-section__btn--danger"
          onClick={() => void controller?.clearQueue()}
        >
          Delete all queued reports
        </button>
      )}

      <h3 className="settings-section__title">Local diagnostics</h3>
      <p className="privacy-section__description">
        Export a support bundle with the technical details above. It never leaves your machine
        unless you share it yourself.
      </p>
      {bundleUrl ? (
        <a className="privacy-section__btn" href={bundleUrl} download="varve-support-bundle.json">
          Download support bundle
        </a>
      ) : (
        <button type="button" className="privacy-section__btn" onClick={() => void handleExport()}>
          Export local diagnostics
        </button>
      )}
      {error && (
        <p role="alert" className="privacy-section__error">
          {error}
        </p>
      )}

      <p className="privacy-section__note">
        Crash reports are minimized and automatically scrubbed of file paths, names, and document
        content — but technical information can still sometimes be identifying. Crash reporting is a
        separate consent category and is never enabled by usage analytics or diagnostics.
      </p>
      <p className="privacy-section__note">
        For privacy questions, contact <ContactLink channel="privacy" />. For product help, contact{' '}
        <ContactLink channel="support" />. Review any diagnostics before sharing them; Varve never
        attaches a project automatically.
      </p>
    </div>
  );
}

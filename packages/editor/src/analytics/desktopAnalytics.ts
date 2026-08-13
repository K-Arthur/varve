import {
  AnalyticsClient,
  type AnalyticsConsent,
  type AnalyticsPlatform,
  DEFAULT_ANALYTICS_CONSENT,
  HttpAnalyticsProvider,
  NoopAnalyticsProvider,
} from '@varve/shared';
import { getReleaseInfo } from '../crash/releaseInfo';
import { loadSettings, type PrivacySettingsStore } from '../settings';

let client: AnalyticsClient | null = null;

function consentFromSettings(settings: PrivacySettingsStore): AnalyticsConsent {
  return {
    website: 'denied',
    usage: settings.usageAnalytics,
    diagnostics: settings.diagnostics,
  };
}

/**
 * Configure the app-owned client once at desktop boot. No endpoint is
 * configured by default; a future aggregate endpoint must be public client
 * configuration, HTTPS-only, and separately reviewed.
 */
export function configureDesktopAnalytics(options?: {
  platform?: AnalyticsPlatform;
  endpoint?: string | null;
}): AnalyticsClient {
  const release = getReleaseInfo();
  // The desktop adapter intentionally uses the no-op provider until an
  // operational ingestion service exists. This makes production builds
  // network-silent even when a user opts in.
  client = new AnalyticsClient({
    context: {
      appVersion: release.appVersion,
      platform: options?.platform ?? 'unknown',
      runtime: 'desktop',
      releaseChannel: release.buildChannel,
    },
    consent: consentFromSettings(loadSettings().privacy),
    provider: options?.endpoint
      ? new HttpAnalyticsProvider({ endpoint: options.endpoint })
      : new NoopAnalyticsProvider(),
  });
  return client;
}

export function getDesktopAnalytics(): AnalyticsClient {
  return client ?? configureDesktopAnalytics();
}

export function updateDesktopAnalyticsConsent(settings: PrivacySettingsStore): void {
  getDesktopAnalytics().updateConsent(consentFromSettings(settings));
}

export function resetDesktopAnalyticsForTests(): void {
  client = null;
}

export { DEFAULT_ANALYTICS_CONSENT };

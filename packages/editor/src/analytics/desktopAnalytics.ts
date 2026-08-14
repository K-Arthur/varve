import {
  AnalyticsClient,
  type AnalyticsConsent,
  type AnalyticsEvent,
  type AnalyticsPlatform,
  type AnalyticsProvider,
  DEFAULT_ANALYTICS_CONSENT,
  HttpAnalyticsProvider,
  NoopAnalyticsProvider,
  safeAnalyticsEndpoint,
} from '@varve/shared';
import { getReleaseInfo } from '../crash/releaseInfo';
import { loadSettings, type PrivacySettingsStore } from '../settings';

let client: AnalyticsClient | null = null;

const PLAUSIBLE_ENDPOINT = 'https://plausible.io/api/event';

function safeDomain(domain: string): string | null {
  return /^[A-Za-z0-9.-]{1,253}$/.test(domain) ? domain : null;
}

/**
 * Desktop adapter for the same aggregate Plausible site as the website.
 *
 * It sends only the closed event payload plus low-cardinality build context.
 * No cookies, identifiers, document data, paths, or design content are sent.
 */
class PlausibleDesktopProvider implements AnalyticsProvider {
  private readonly endpoint: string | null;
  private readonly domain: string;
  private readonly pending: AnalyticsEvent[] = [];

  constructor(domain: string) {
    this.domain = domain;
    this.endpoint = safeAnalyticsEndpoint(PLAUSIBLE_ENDPOINT);
  }

  async initialize(): Promise<void> {}

  track(event: AnalyticsEvent): void {
    if (this.pending.length < 50) this.pending.push(event);
  }

  async flush(): Promise<void> {
    if (!this.endpoint || this.pending.length === 0) return;
    const events = this.pending.splice(0, this.pending.length);
    await Promise.all(
      events.map(async (event) => {
        const payload = event.payload as Record<string, string>;
        const props = {
          ...payload,
          app_version: event.context.appVersion,
          platform: event.context.platform,
          release_channel: event.context.releaseChannel,
        };
        try {
          await fetch(this.endpoint!, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              domain: this.domain,
              name: event.name,
              url: new URL('/app', `https://${this.domain}`).toString(),
              props,
              interactive: false,
            }),
            keepalive: false,
          });
        } catch {
          // Provider outages cannot affect editing or startup.
        }
      }),
    );
  }

  async shutdown(): Promise<void> {
    this.pending.length = 0;
  }
}

function consentFromSettings(settings: PrivacySettingsStore): AnalyticsConsent {
  return {
    website: 'denied',
    usage: settings.usageAnalytics,
    diagnostics: settings.diagnostics,
  };
}

/** Configure the app-owned client once at desktop boot. */
export function configureDesktopAnalytics(options?: {
  platform?: AnalyticsPlatform;
  endpoint?: string | null;
  domain?: string | null;
}): AnalyticsClient {
  const release = getReleaseInfo();
  // Unconfigured builds remain network-silent. Production releases select the
  // Plausible adapter through the public domain build variable.
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
      : options?.domain && safeDomain(options.domain)
        ? new PlausibleDesktopProvider(options.domain)
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

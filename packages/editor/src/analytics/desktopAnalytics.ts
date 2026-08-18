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
let hasConfiguredEndpoint = false;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;

const PLAUSIBLE_ENDPOINT = 'https://plausible.io/api/event';
const FLUSH_INTERVAL_MS = 30_000;

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

function flushNow(): void {
  if (!client) return;
  void client.flush();
}

function handleBeforeUnload(): void {
  flushNow();
}

/**
 * Start the periodic flush timer and the beforeunload listener.
 * Safe to call multiple times — no-ops if already running.
 */
export function startDesktopFlushTimer(): void {
  if (flushIntervalId !== null) return;
  flushIntervalId = setInterval(flushNow, FLUSH_INTERVAL_MS);
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleBeforeUnload);
  }
}

/** Stop the periodic flush timer and remove the beforeunload listener. */
export function stopDesktopFlushTimer(): void {
  if (flushIntervalId !== null) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  }
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
  const provider = options?.endpoint
    ? new HttpAnalyticsProvider({ endpoint: options.endpoint })
    : options?.domain && safeDomain(options.domain)
      ? new PlausibleDesktopProvider(options.domain)
      : new NoopAnalyticsProvider();
  hasConfiguredEndpoint = !(provider instanceof NoopAnalyticsProvider);
  client = new AnalyticsClient({
    context: {
      appVersion: release.appVersion,
      platform: options?.platform ?? 'unknown',
      runtime: 'desktop',
      releaseChannel: release.buildChannel,
    },
    consent: consentFromSettings(loadSettings().privacy),
    provider,
  });
  return client;
}

/**
 * Whether this build was started with a sending analytics endpoint or domain.
 * Enabling a consent category in an unconfigured build must not claim (or
 * imply) that a network request will be made.
 */
export function hasConfiguredAnalyticsEndpoint(): boolean {
  return hasConfiguredEndpoint;
}

export function getDesktopAnalytics(): AnalyticsClient {
  return client ?? configureDesktopAnalytics();
}

export function updateDesktopAnalyticsConsent(settings: PrivacySettingsStore): void {
  getDesktopAnalytics().updateConsent(consentFromSettings(settings));
}

export function resetDesktopAnalyticsForTests(): void {
  client = null;
  hasConfiguredEndpoint = false;
  stopDesktopFlushTimer();
}

export { DEFAULT_ANALYTICS_CONSENT };

/**
 * Bucket a millisecond duration into a low-cardinality analytics bucket.
 * The boundaries are deliberately coarse — they answer "fast / medium / slow"
 * without retaining numeric timing data.
 */
export function durationBucket(
  ms: number,
): 'under_16ms' | '16_33ms' | '33_50ms' | '50_100ms' | '100_250ms' | 'over_250ms' {
  if (ms < 16) return 'under_16ms';
  if (ms < 33) return '16_33ms';
  if (ms < 50) return '33_50ms';
  if (ms < 100) return '50_100ms';
  if (ms < 250) return '100_250ms';
  return 'over_250ms';
}

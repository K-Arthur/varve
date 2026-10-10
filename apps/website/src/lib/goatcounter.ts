import type { AnalyticsEvent, AnalyticsEventMap, AnalyticsProvider } from '@varve/shared';

/** Public collector hostname only. Never accept a URL, credential or arbitrary host. */
export function safeGoatCounterDomain(domain: string): string | null {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.goatcounter\.com$/.test(domain) ? domain : null;
}

/** Drop credentials, path, query and fragment; same-site navigation isn't acquisition. */
export function websiteReferrer(referrer: string, origin: string): string {
  try {
    const url = new URL(referrer);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin === origin) return '';
    return url.origin;
  } catch {
    return '';
  }
}

/**
 * First-party channel tags we put on our own links (`?ref=masto-p1`).
 * Anything else — including unknown `ref` values — is dropped.
 */
export const WEBSITE_CAMPAIGN_REF =
  /^(masto|bsky|yt|reddit|hn|ph|uneed|saashub|x|ig|threads|discord|lnl|press|email|aur|flathub|winget)-[a-z0-9-]{1,24}$/;

/** Keep only an allowlisted `ref` campaign tag; drop every other query param. */
export function websiteCampaignRef(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const ref = params.get('ref');
  return ref && WEBSITE_CAMPAIGN_REF.test(ref) ? ref : null;
}

/** GoatCounter campaign via documented `path?ref=` (pixel `/count` splits query from `p`). */
export function pathWithCampaign(path: string, search: string): string {
  const ref = websiteCampaignRef(search);
  return ref ? `${path}?ref=${ref}` : path;
}

interface GoatCounterOptions {
  domain: string;
  canSend: () => boolean;
  route: () => string;
  referrer: () => string;
  search?: () => string;
  fetchImpl?: typeof fetch;
}

/**
 * Aggregate website-only transport. No remote script, browser fingerprint, session,
 * screen dimensions, page title, persistent ID or design content. The only query
 * forwarded is an allowlisted first-party `ref` campaign tag, as `path?ref=`.
 * The account MUST have Sessions and Individual pageviews disabled before activation.
 * GoatCounter's documented /count transport is only used from the visitor's browser.
 */
export class GoatCounterProvider implements AnalyticsProvider {
  private readonly endpoint: string | null;
  private readonly options: GoatCounterOptions;
  private readonly pending: AnalyticsEvent[] = [];
  private readonly active = new Set<AbortController>();

  constructor(options: GoatCounterOptions) {
    this.options = options;
    const domain = safeGoatCounterDomain(options.domain);
    this.endpoint = domain ? `https://${domain}/count` : null;
  }

  async initialize(): Promise<void> {}

  track(event: AnalyticsEvent): void {
    if (
      this.endpoint &&
      this.options.canSend() &&
      event.category === 'website' &&
      (event.name === 'website_page_viewed' ||
        event.name === 'website_download_started' ||
        event.name === 'browser_demo_desktop_download') &&
      this.pending.length < 25
    ) {
      this.pending.push(event);
    }
  }

  async flush(): Promise<void> {
    const events = this.pending.splice(0);
    if (!this.endpoint || !this.options.canSend()) return;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    for (const event of events) {
      if (!this.options.canSend()) return;
      const pageview = event.name === 'website_page_viewed';
      const path = pathWithCampaign(
        pageview
          ? (event.payload as AnalyticsEventMap['website_page_viewed']).route
          : this.downloadPath(event.payload as AnalyticsEventMap['website_download_started']),
        this.options.search?.() ?? '',
      );
      const url = new URL(this.endpoint);
      url.searchParams.set('p', path);
      url.searchParams.set('ns', 'true');
      if (!pageview) url.searchParams.set('e', 'true');
      const referrer = pageview ? this.options.referrer() : '';
      if (referrer) url.searchParams.set('r', referrer);
      const controller = new AbortController();
      this.active.add(controller);
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        // POST avoids cache-based undercounts without a per-hit random identifier.
        // No cookies or page URL Referer are sent to the provider.
        await fetchImpl(url.toString(), {
          method: 'POST',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          keepalive: true,
          signal: controller.signal,
        });
      } catch {
        // Never retry tracking: uncertainty must not inflate counts or break downloads.
      } finally {
        clearTimeout(timer);
        this.active.delete(controller);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.pending.length = 0;
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }

  private downloadPath(payload: AnalyticsEventMap['website_download_started']): string {
    // Input comes from AnalyticsClient's closed, sanitized website event schema.
    return [
      'website_download_clicked',
      this.options.route(),
      payload.platform,
      payload.architecture,
      payload.packageType,
      payload.release,
      payload.releaseChannel ?? 'unknown',
    ].join('|');
  }
}

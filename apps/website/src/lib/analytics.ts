import {
  AnalyticsClient,
  type AnalyticsConsentState,
  type AnalyticsEvent,
  type AnalyticsEventMap,
  type AnalyticsProvider,
  sanitizeAnalyticsContext,
} from '@varve/shared';

const CONSENT_KEY = 'varve:website-analytics-consent';
const PLAUSIBLE_SCRIPT = 'https://plausible.io/js/pa-9Rpt-MZjJts8awPbiRZl3.js';

type PlausibleEventOptions = {
  props?: Record<string, string>;
  u?: string;
  interactive?: boolean;
};

type PlausibleClient = ((name: string, options?: PlausibleEventOptions) => void) & {
  init?: (options?: Record<string, unknown>) => void;
  l?: boolean;
  o?: Record<string, unknown>;
  q?: Array<[string, PlausibleEventOptions?]>;
};

interface WebsiteAnalyticsOptions {
  domain: string;
  enabled: boolean;
}

interface AnalyticsWindow extends Window {
  __varveWebsiteAnalytics?: WebsiteAnalyticsController;
  plausible?: PlausibleClient;
}

interface DownloadTarget extends HTMLElement {
  dataset: DOMStringMap & {
    analyticsDownload?: string;
    analyticsPlatform?: string;
    analyticsArchitecture?: string;
    analyticsPackageType?: string;
    analyticsRelease?: string;
    analyticsReleaseChannel?: string;
  };
}

function readConsent(): AnalyticsConsentState {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

function writeConsent(value: AnalyticsConsentState): void {
  try {
    if (value === 'unknown') window.localStorage.removeItem(CONSENT_KEY);
    else window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Storage restrictions fail closed; the in-memory client still works for
    // this page if the user explicitly grants consent.
  }
}

function privacySignalBlocks(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

function normalizedRoute(
  pathname: string,
):
  | '/'
  | '/download'
  | '/releases'
  | '/features'
  | '/docs'
  | '/contribute'
  | '/support'
  | '/about/privacy' {
  const path = pathname.toLowerCase();
  if (path.includes('/about/privacy')) return '/about/privacy';
  if (path.includes('/download')) return '/download';
  if (path.includes('/releases')) return '/releases';
  if (path.includes('/features')) return '/features';
  if (path.includes('/docs')) return '/docs';
  if (path.includes('/contribute')) return '/contribute';
  if (path.includes('/support')) return '/support';
  return '/';
}

function safeDomain(domain: string): string | null {
  return /^[A-Za-z0-9.-]{1,253}$/.test(domain) ? domain : null;
}

function platform(value: string | undefined): 'linux' | 'windows' | 'macos' | 'unknown' {
  return value === 'linux' || value === 'windows' || value === 'macos' ? value : 'unknown';
}

function architecture(value: string | undefined): 'x64' | 'arm64' | 'unknown' {
  return value === 'x64' || value === 'arm64' ? value : 'unknown';
}

function packageType(
  value: string | undefined,
): 'appimage' | 'deb' | 'rpm' | 'dmg' | 'nsis' | 'unknown' {
  return value === 'appimage' ||
    value === 'deb' ||
    value === 'rpm' ||
    value === 'dmg' ||
    value === 'nsis'
    ? value
    : 'unknown';
}

function releaseChannel(value: string | undefined): 'beta' | 'stable' | 'prerelease' {
  return value === 'stable' || value === 'prerelease' ? value : 'beta';
}

class PlausibleEventsProvider implements AnalyticsProvider {
  private readonly domain: string;
  private readonly pending: AnalyticsEvent[] = [];

  constructor(domain: string) {
    this.domain = domain;
  }

  async initialize(): Promise<void> {
    const win = window as AnalyticsWindow;
    if (win.plausible?.l) return;

    let plausible = win.plausible;
    if (!plausible) {
      const queued: Array<[string, PlausibleEventOptions?]> = [];
      plausible = ((...args: [string, PlausibleEventOptions?]) => {
        queued.push(args);
      }) as PlausibleClient;
      plausible.q = queued;
    }
    plausible.q ??= [];
    plausible.init ??= (options) => {
      plausible.o = options;
    };
    plausible.init({
      domain: this.domain,
      autoCapturePageviews: false,
      fileDownloads: false,
      outboundLinks: false,
      formSubmissions: false,
    });
    win.plausible = plausible;

    if (!document.querySelector(`script[data-varve-plausible="true"]`)) {
      const script = document.createElement('script');
      script.async = true;
      script.src = PLAUSIBLE_SCRIPT;
      script.dataset.varvePlausible = 'true';
      document.head.appendChild(script);
    }
  }

  track(event: AnalyticsEvent): void {
    if (this.pending.length < 25) this.pending.push(event);
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const plausible = (window as AnalyticsWindow).plausible;
    if (!plausible) return;
    const events = this.pending.splice(0, this.pending.length);
    for (const event of events) {
      const pagePayload = event.payload as AnalyticsEventMap['website_page_viewed'];
      const route =
        event.name === 'website_page_viewed'
          ? pagePayload.route
          : normalizedRoute(window.location.pathname);
      const props =
        event.name === 'website_download_started'
          ? (() => {
              const payload = event.payload as AnalyticsEventMap['website_download_started'];
              return {
                release: payload.release,
                platform: payload.platform,
                architecture: payload.architecture,
                package_type: payload.packageType,
                release_channel: payload.releaseChannel,
              };
            })()
          : event.name === 'website_outbound_clicked'
            ? {
                destination: (event.payload as AnalyticsEventMap['website_outbound_clicked'])
                  .destination,
              }
            : undefined;
      plausible(event.name === 'website_page_viewed' ? 'pageview' : event.name, {
        props,
        u: new URL(route, window.location.origin).toString(),
        interactive: false,
      });
    }
  }

  async shutdown(): Promise<void> {
    this.pending.length = 0;
  }
}

export class WebsiteAnalyticsController {
  private readonly client: AnalyticsClient;
  private readonly banner: HTMLElement | null;
  private readonly blockedBySignal: boolean;

  constructor(domain: string, banner: HTMLElement | null) {
    this.banner = banner;
    this.blockedBySignal = privacySignalBlocks();
    const context = sanitizeAnalyticsContext({
      appVersion: 'website',
      platform: 'unknown',
      runtime: 'web',
      releaseChannel: 'production',
    });
    this.client = new AnalyticsClient({
      context: context ?? {
        appVersion: 'website',
        platform: 'unknown',
        runtime: 'web',
        releaseChannel: 'production',
      },
      consent: {
        website: this.blockedBySignal ? 'denied' : readConsent(),
        usage: 'denied',
        diagnostics: 'denied',
      },
      provider: new PlausibleEventsProvider(domain),
      maxQueueSize: 25,
    });
  }

  start(): void {
    if (this.blockedBySignal) {
      this.hideBanner();
      return;
    }
    const consent = readConsent();
    if (consent === 'granted') {
      this.enable();
      this.trackPageView();
    } else if (consent === 'unknown') this.showBanner();
  }

  choose(value: 'granted' | 'denied'): void {
    writeConsent(value);
    this.client.updateConsent({ website: value, usage: 'denied', diagnostics: 'denied' });
    this.hideBanner();
    if (value === 'granted') {
      this.enable();
      this.trackPageView();
    }
  }

  withdraw(): void {
    writeConsent('denied');
    this.client.updateConsent({ website: 'denied', usage: 'denied', diagnostics: 'denied' });
    this.showBanner();
  }

  private enable(): void {
    this.client.updateConsent({ website: 'granted', usage: 'denied', diagnostics: 'denied' });
  }

  private trackPageView(): void {
    this.client.track('website_page_viewed', { route: normalizedRoute(window.location.pathname) });
    void this.client.flush();
  }

  trackDownload(element: DownloadTarget): void {
    if (readConsent() !== 'granted' || this.blockedBySignal) return;
    this.client.track('website_download_started', {
      release: element.dataset.analyticsRelease ?? 'unknown',
      platform: platform(element.dataset.analyticsPlatform),
      architecture: architecture(element.dataset.analyticsArchitecture),
      packageType: packageType(element.dataset.analyticsPackageType),
      releaseChannel: releaseChannel(element.dataset.analyticsReleaseChannel),
    });
    void this.client.flush();
  }

  trackOutbound(destination: 'github' | 'docs' | 'community'): void {
    if (readConsent() !== 'granted' || this.blockedBySignal) return;
    this.client.track('website_outbound_clicked', { destination });
    void this.client.flush();
  }

  private showBanner(): void {
    if (this.banner) this.banner.hidden = false;
  }

  private hideBanner(): void {
    if (this.banner) this.banner.hidden = true;
  }
}

export function initWebsiteAnalytics(options: WebsiteAnalyticsOptions): void {
  if (!options.enabled) return;
  const domain = safeDomain(options.domain);
  if (!domain) return;
  const win = window as AnalyticsWindow;
  const controller = new WebsiteAnalyticsController(
    domain,
    document.getElementById('website-analytics-consent'),
  );
  win.__varveWebsiteAnalytics = controller;
  controller.start();
  document.querySelectorAll<DownloadTarget>('[data-analytics-download]').forEach((element) => {
    element.addEventListener('click', () => controller.trackDownload(element), { passive: true });
  });
  document.querySelectorAll<HTMLElement>('[data-analytics-outbound]').forEach((element) => {
    const destination = element.dataset.analyticsOutbound;
    if (destination === 'github' || destination === 'docs' || destination === 'community') {
      element.addEventListener('click', () => controller.trackOutbound(destination), {
        passive: true,
      });
    }
  });
  document.querySelectorAll<HTMLElement>('[data-analytics-choice]').forEach((element) => {
    element.addEventListener('click', () => {
      const value = element.dataset.analyticsChoice;
      if (value === 'granted' || value === 'denied') controller.choose(value);
    });
  });
  document.querySelectorAll<HTMLElement>('[data-analytics-withdraw]').forEach((element) => {
    element.addEventListener('click', () => controller.withdraw());
  });
}

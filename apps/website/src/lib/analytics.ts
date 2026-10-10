import {
  AnalyticsClient,
  type AnalyticsConsentState,
  sanitizeAnalyticsContext,
} from '@varve/shared';

import { GoatCounterProvider, safeGoatCounterDomain, websiteReferrer } from './goatcounter';

const CONSENT_KEY = 'varve:website-analytics-consent:goatcounter-v1';
const LEGACY_CONSENT_KEY = 'varve:website-analytics-consent';

interface WebsiteAnalyticsOptions {
  domain: string;
  enabled: boolean;
}

interface AnalyticsWindow extends Window {
  __varveWebsiteAnalytics?: WebsiteAnalyticsController;
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
    if (value === 'granted' || value === 'denied') return value;
    // Keep prior refusals; a grant to the previous provider does not transfer.
    return window.localStorage.getItem(LEGACY_CONSENT_KEY) === 'denied' ? 'denied' : 'unknown';
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
  | '/about/privacy'
  | '/accessibility'
  | '/try' {
  const path = pathname.toLowerCase();
  if (path.includes('/about/privacy')) return '/about/privacy';
  if (path.includes('/accessibility')) return '/accessibility';
  if (path === '/try' || path.startsWith('/try/')) return '/try';
  if (path.includes('/download')) return '/download';
  if (path.includes('/releases')) return '/releases';
  if (path.includes('/features')) return '/features';
  if (path.includes('/docs')) return '/docs';
  if (path.includes('/contribute')) return '/contribute';
  if (path.includes('/support')) return '/support';
  return '/';
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

export class WebsiteAnalyticsController {
  private readonly client: AnalyticsClient;
  private readonly banner: HTMLElement | null;
  private readonly blockedBySignal: boolean;
  private consent: AnalyticsConsentState;
  private pageviewSent = false;

  constructor(domain: string, banner: HTMLElement | null) {
    this.banner = banner;
    this.blockedBySignal = privacySignalBlocks();
    this.consent = this.blockedBySignal ? 'denied' : readConsent();
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
        website: this.consent,
        usage: 'denied',
        diagnostics: 'denied',
      },
      provider: new GoatCounterProvider({
        domain,
        canSend: () => this.consent === 'granted' && !privacySignalBlocks(),
        route: () => normalizedRoute(window.location.pathname),
        referrer: () => websiteReferrer(document.referrer, window.location.origin),
        search: () => window.location.search,
      }),
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
    if (this.blockedBySignal || privacySignalBlocks()) value = 'denied';
    this.consent = value;
    writeConsent(value);
    this.client.updateConsent({ website: value, usage: 'denied', diagnostics: 'denied' });
    this.hideBanner();
    if (value === 'granted') {
      this.enable();
      this.trackPageView();
    }
  }

  withdraw(): void {
    this.consent = 'denied';
    writeConsent('denied');
    this.client.updateConsent({ website: 'denied', usage: 'denied', diagnostics: 'denied' });
    this.showBanner();
  }

  private enable(): void {
    this.client.updateConsent({ website: 'granted', usage: 'denied', diagnostics: 'denied' });
  }

  private trackPageView(): void {
    if (this.pageviewSent || this.consent !== 'granted' || privacySignalBlocks()) return;
    this.pageviewSent = true;
    this.client.track('website_page_viewed', { route: normalizedRoute(window.location.pathname) });
    void this.client.flush();
  }

  trackDownload(element: DownloadTarget): void {
    if (this.consent !== 'granted' || privacySignalBlocks()) return;
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
    if (this.consent !== 'granted' || privacySignalBlocks()) return;
    this.client.track('website_outbound_clicked', { destination });
    void this.client.flush();
  }

  trackContact(
    channel: 'general' | 'support' | 'feedback' | 'security' | 'privacy' | 'press' | 'partnerships',
  ): void {
    if (this.consent !== 'granted' || privacySignalBlocks()) return;
    this.client.track('website_contact_clicked', { channel });
    void this.client.flush();
  }

  trackDemoLaunch(entry: 'website' | 'direct'): void {
    if (this.consent !== 'granted' || privacySignalBlocks()) return;
    this.client.track('browser_demo_launched', { entry });
    void this.client.flush();
  }

  trackDemoDownload(element: DownloadTarget): void {
    if (this.consent !== 'granted' || privacySignalBlocks()) return;
    this.client.track('browser_demo_desktop_download', {
      release: element.dataset.analyticsRelease ?? 'unknown',
      platform: platform(element.dataset.analyticsPlatform),
      architecture: architecture(element.dataset.analyticsArchitecture),
      packageType: packageType(element.dataset.analyticsPackageType),
    });
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
  const domain = safeGoatCounterDomain(options.domain);
  if (!domain) return;
  const win = window as AnalyticsWindow;
  if (win.__varveWebsiteAnalytics) return;
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
  document.querySelectorAll<HTMLElement>('[data-analytics-contact]').forEach((element) => {
    const channel = element.dataset.analyticsContact;
    if (
      channel === 'general' ||
      channel === 'support' ||
      channel === 'feedback' ||
      channel === 'security' ||
      channel === 'privacy' ||
      channel === 'press' ||
      channel === 'partnerships'
    ) {
      element.addEventListener('click', () => controller.trackContact(channel), { passive: true });
    }
  });
  document.querySelectorAll<DownloadTarget>('[data-analytics-demo-download]').forEach((element) => {
    element.addEventListener('click', () => controller.trackDemoDownload(element), {
      passive: true,
    });
  });
  // The demo itself is a separate bundle with analytics disabled, so a launch
  // can only be counted from the site that sends the visitor there. That makes
  // 'website' the sole entry value this listener can honestly report — someone
  // arriving at /try directly is not observable from here, by design.
  document.querySelectorAll('[data-analytics-demo-launch]').forEach((element) => {
    element.addEventListener('click', () => controller.trackDemoLaunch('website'), {
      passive: true,
    });
  });
}

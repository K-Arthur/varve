/**
 * Varve-owned analytics contract.
 *
 * This is deliberately a closed vocabulary. Adding an event is a product and
 * privacy decision; arbitrary event names and arbitrary payload objects are
 * not part of the API.
 */

export const ANALYTICS_SCHEMA_VERSION = 1 as const;

export type AnalyticsCategory = 'website' | 'usage' | 'diagnostics';
export type AnalyticsConsentState = 'unknown' | 'granted' | 'denied';

export interface AnalyticsConsent {
  website: AnalyticsConsentState;
  usage: AnalyticsConsentState;
  diagnostics: AnalyticsConsentState;
}

export type AnalyticsPlatform = 'linux' | 'windows' | 'macos' | 'unknown';
export type AnalyticsRuntime = 'desktop' | 'web';
export type AnalyticsReleaseChannel = 'dev' | 'nightly' | 'beta' | 'production';

export interface AnalyticsContext {
  appVersion: string;
  platform: AnalyticsPlatform;
  runtime: AnalyticsRuntime;
  releaseChannel: AnalyticsReleaseChannel;
}

export type AnalyticsFeature =
  | 'pen'
  | 'shape'
  | 'text'
  | 'image_trace'
  | 'background_removal'
  | 'upscale'
  | 'prototype_preview'
  | 'print'
  | 'gradient_map'
  | 'adjustment_layer'
  | 'component'
  | 'pages';

export type AnalyticsDurationBucket =
  | 'under_16ms'
  | '16_33ms'
  | '33_50ms'
  | '50_100ms'
  | '100_250ms'
  | 'over_250ms';

export type AnalyticsExportFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf' | 'gif' | 'webm';
export type AnalyticsExportErrorCode =
  | 'cancelled'
  | 'unsupported_format'
  | 'permission_denied'
  | 'render_failed'
  | 'unknown';
export type AnalyticsRenderer = 'canvas2d' | 'webgpu' | 'webgl';
export type AnalyticsRendererFallbackReason =
  | 'unavailable'
  | 'device_lost'
  | 'unsupported_primitive'
  | 'worker_failed'
  | 'initialization_failed';
export type AnalyticsWebsiteRoute =
  | '/'
  | '/download'
  | '/releases'
  | '/features'
  | '/docs'
  | '/contribute'
  | '/support'
  | '/about/privacy';
export type AnalyticsWebsitePlatform = 'linux' | 'windows' | 'macos' | 'unknown';
export type AnalyticsPackageType = 'appimage' | 'deb' | 'rpm' | 'dmg' | 'nsis' | 'unknown';
export type AnalyticsOutboundDestination = 'github' | 'docs' | 'community';

export interface AnalyticsEventMap {
  app_launched: {
    surface: 'desktop' | 'website';
  };
  document_created: {
    source: 'blank' | 'template' | 'import';
  };
  feature_used: {
    feature: AnalyticsFeature;
  };
  export_completed: {
    format: AnalyticsExportFormat;
    durationBucket: AnalyticsDurationBucket;
  };
  export_failed: {
    format: AnalyticsExportFormat;
    code: AnalyticsExportErrorCode;
  };
  renderer_fallback: {
    from: AnalyticsRenderer;
    to: AnalyticsRenderer;
    reason: AnalyticsRendererFallbackReason;
  };
  performance_sample: {
    metric: 'startup' | 'export' | 'interaction';
    durationBucket: AnalyticsDurationBucket;
  };
  website_page_viewed: {
    route: AnalyticsWebsiteRoute;
  };
  website_download_started: {
    release: string;
    platform: AnalyticsWebsitePlatform;
    architecture: 'x64' | 'arm64' | 'unknown';
    packageType: AnalyticsPackageType;
    releaseChannel: 'beta' | 'stable' | 'prerelease';
  };
  website_outbound_clicked: {
    destination: AnalyticsOutboundDestination;
  };
}

export const ANALYTICS_EVENT_CATEGORIES: {
  [K in keyof AnalyticsEventMap]: AnalyticsCategory;
} = {
  app_launched: 'usage',
  document_created: 'usage',
  feature_used: 'usage',
  export_completed: 'usage',
  export_failed: 'diagnostics',
  renderer_fallback: 'diagnostics',
  performance_sample: 'diagnostics',
  website_page_viewed: 'website',
  website_download_started: 'website',
  website_outbound_clicked: 'website',
  website_contact_clicked: 'website',
  browser_demo_launched: 'usage',
  browser_demo_desktop_download: 'website',
};

export type AnalyticsEventName = keyof AnalyticsEventMap;

export interface AnalyticsEvent<N extends AnalyticsEventName = AnalyticsEventName> {
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  name: N;
  category: (typeof ANALYTICS_EVENT_CATEGORIES)[N];
  payload: AnalyticsEventMap[N];
  context: AnalyticsContext;
  occurredAt: number;
}

export const DEFAULT_ANALYTICS_CONSENT: AnalyticsConsent = {
  website: 'unknown',
  usage: 'unknown',
  diagnostics: 'unknown',
};

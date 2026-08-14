import {
  ANALYTICS_EVENT_CATEGORIES,
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsContext,
  type AnalyticsEvent,
  type AnalyticsEventMap,
  type AnalyticsEventName,
} from './schema';

/**
 * Defense-in-depth denylist. The closed event map is the primary boundary;
 * this catches accidental expansion in future validators and hostile runtime
 * input before anything reaches a provider.
 */
export const ANALYTICS_FORBIDDEN_KEYS = new Set([
  'filename',
  'fileName',
  'filepath',
  'filePath',
  'path',
  'document',
  'documentName',
  'documentId',
  'layerName',
  'pageName',
  'componentName',
  'text',
  'content',
  'clipboard',
  'email',
  'username',
  'token',
  'authorization',
  'cookie',
  'url',
  'referrer',
  'query',
  'stack',
  'screenshot',
  'pixels',
  'image',
  'prompt',
  'hostname',
  'machineId',
  'deviceId',
]);

const VALUE_SETS: Record<string, readonly string[]> = {
  surface: ['desktop', 'website'],
  source: ['blank', 'template', 'import'],
  feature: [
    'pen',
    'shape',
    'text',
    'image_trace',
    'background_removal',
    'upscale',
    'prototype_preview',
    'print',
    'gradient_map',
    'adjustment_layer',
    'component',
    'pages',
  ],
  format: ['png', 'jpeg', 'webp', 'svg', 'pdf', 'gif', 'webm'],
  code: ['cancelled', 'unsupported_format', 'permission_denied', 'render_failed', 'unknown'],
  from: ['canvas2d', 'webgpu', 'webgl'],
  to: ['canvas2d', 'webgpu', 'webgl'],
  reason: [
    'unavailable',
    'device_lost',
    'unsupported_primitive',
    'worker_failed',
    'initialization_failed',
  ],
  metric: ['startup', 'export', 'interaction'],
  durationBucket: ['under_16ms', '16_33ms', '33_50ms', '50_100ms', '100_250ms', 'over_250ms'],
  route: [
    '/',
    '/download',
    '/releases',
    '/features',
    '/docs',
    '/contribute',
    '/support',
    '/about/privacy',
  ],
  platform: ['linux', 'windows', 'macos', 'unknown'],
  architecture: ['x64', 'arm64', 'unknown'],
  packageType: ['appimage', 'deb', 'rpm', 'dmg', 'nsis', 'unknown'],
  releaseChannel: ['beta', 'stable', 'prerelease'],
  destination: ['github', 'docs', 'community'],
};

const EVENT_FIELDS: {
  [K in AnalyticsEventName]: readonly (keyof AnalyticsEventMap[K])[];
} = {
  app_launched: ['surface'],
  document_created: ['source'],
  feature_used: ['feature'],
  export_completed: ['format', 'durationBucket'],
  export_failed: ['format', 'code'],
  renderer_fallback: ['from', 'to', 'reason'],
  performance_sample: ['metric', 'durationBucket'],
  website_page_viewed: ['route'],
  website_download_started: [
    'release',
    'platform',
    'architecture',
    'packageType',
    'releaseChannel',
  ],
  website_outbound_clicked: ['destination'],
};

function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  return Object.entries(value).some(
    ([key, child]) => ANALYTICS_FORBIDDEN_KEYS.has(key) || hasForbiddenKey(child),
  );
}

function isSafeVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(value);
}

export function sanitizeAnalyticsContext(context: AnalyticsContext): AnalyticsContext | null {
  if (
    !isSafeVersion(context.appVersion) ||
    !['linux', 'windows', 'macos', 'unknown'].includes(context.platform) ||
    !['desktop', 'web'].includes(context.runtime) ||
    !['dev', 'nightly', 'beta', 'production'].includes(context.releaseChannel)
  ) {
    return null;
  }
  return { ...context };
}

/** Validate and clone one closed-schema event. Unknown keys are rejected. */
export function sanitizeAnalyticsEvent<N extends AnalyticsEventName>(
  name: N,
  payload: AnalyticsEventMap[N],
  context: AnalyticsContext,
  occurredAt: number,
): AnalyticsEvent<N> | null {
  if (!Object.hasOwn(ANALYTICS_EVENT_CATEGORIES, name)) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (hasForbiddenKey(payload)) return null;
  const fields = EVENT_FIELDS[name] as readonly string[];
  const keys = Object.keys(payload);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) return null;
  for (const key of fields) {
    const value = (payload as Record<string, unknown>)[key];
    if (key === 'release') {
      if (!isSafeVersion(value)) return null;
    } else if (typeof value !== 'string' || !VALUE_SETS[key]?.includes(value)) {
      return null;
    }
  }
  const safeContext = sanitizeAnalyticsContext(context);
  if (!safeContext || !Number.isFinite(occurredAt)) return null;
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    name,
    category: ANALYTICS_EVENT_CATEGORIES[name],
    payload: { ...payload },
    context: safeContext,
    occurredAt,
  } as AnalyticsEvent<N>;
}

export function eventFields(name: AnalyticsEventName): readonly string[] {
  return EVENT_FIELDS[name] as readonly string[];
}

/// <reference types="@webgpu/types" />

/**
 * One bounded WebGPU readiness probe shared by adaptive diagnostics and the
 * settings surface. API presence is intentionally not treated as readiness:
 * adapter selection, device creation, an allowlisted limit read, and cleanup
 * all have to succeed before the result is `supported`.
 */

export type WebGpuProbeStatus = 'unknown' | 'supported' | 'unavailable' | 'failed';

export interface WebGpuCapabilityProbe {
  apiPresent: boolean;
  adapterCreated: boolean;
  deviceCreated: boolean;
  deviceDestroyed: boolean;
  limits: Readonly<Record<string, number>>;
  /** Optional features are not required by the compositor probe. */
  requiredFeatures: readonly string[];
  status: WebGpuProbeStatus;
  isFallbackAdapter?: boolean;
}

const LIMIT_KEYS = [
  'maxTextureDimension2D',
  'maxTextureArrayLayers',
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupsPerDimension',
] as const;

interface ProbeDevice {
  destroy?: () => void;
}

interface ProbeAdapter {
  limits?: unknown;
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  requestDevice?: (descriptor?: { requiredFeatures?: readonly string[] }) => Promise<ProbeDevice>;
}

interface ProbeApi {
  requestAdapter?: (options?: {
    powerPreference?: 'low-power' | 'high-performance';
  }) => Promise<ProbeAdapter | null>;
}

function readLimits(limits: unknown): Readonly<Record<string, number>> {
  if (!limits || typeof limits !== 'object') return {};
  const record = limits as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const key of LIMIT_KEYS) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = value;
  }
  return result;
}

function isFallbackAdapter(adapter: ProbeAdapter): boolean {
  const info = adapter.info;
  const haystack = [info?.vendor, info?.architecture, info?.device, info?.description]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase();
  return ['swift', 'fallback', 'software', 'llvmpipe', 'lavapipe'].some((marker) =>
    haystack.includes(marker),
  );
}

function baseProbe(apiPresent: boolean): WebGpuCapabilityProbe {
  return {
    apiPresent,
    adapterCreated: false,
    deviceCreated: false,
    deviceDestroyed: false,
    limits: {},
    requiredFeatures: [],
    status: apiPresent ? 'failed' : 'unavailable',
  };
}

export async function probeWebGpuCapability(): Promise<WebGpuCapabilityProbe> {
  const api = (typeof navigator === 'undefined' ? undefined : navigator.gpu) as
    | ProbeApi
    | undefined;
  const base = baseProbe(api !== undefined);
  if (!api || typeof api.requestAdapter !== 'function') return { ...base, status: 'unavailable' };

  try {
    const adapter = await api.requestAdapter({ powerPreference: 'low-power' });
    if (!adapter) return { ...base, status: 'unavailable' };
    const limits = readLimits(adapter.limits);
    const fallback = isFallbackAdapter(adapter);
    if (typeof adapter.requestDevice !== 'function') {
      return { ...base, adapterCreated: true, limits, isFallbackAdapter: fallback };
    }
    const device = await adapter.requestDevice({ requiredFeatures: [] });
    let deviceDestroyed = false;
    try {
      device.destroy?.();
      deviceDestroyed = typeof device.destroy === 'function';
    } catch {
      deviceDestroyed = false;
    }
    return {
      apiPresent: true,
      adapterCreated: true,
      deviceCreated: true,
      deviceDestroyed,
      limits,
      requiredFeatures: [],
      status: deviceDestroyed ? 'supported' : 'failed',
      isFallbackAdapter: fallback,
    };
  } catch {
    return { ...base, status: 'failed' };
  }
}

let cachedProbe: WebGpuCapabilityProbe | null = null;
let inFlight: Promise<WebGpuCapabilityProbe> | null = null;

/** Cached session result so a settings render cannot create GPU contexts repeatedly. */
export function getWebGpuCapability(): WebGpuCapabilityProbe {
  if (cachedProbe) return cachedProbe;
  const apiPresent = typeof navigator !== 'undefined' && 'gpu' in navigator;
  if (!apiPresent) return baseProbe(false);
  return { ...baseProbe(true), status: 'unknown' };
}

/** Start the one session probe; concurrent callers share its promise. */
export function ensureWebGpuCapabilityProbe(): Promise<WebGpuCapabilityProbe> {
  if (cachedProbe) return Promise.resolve(cachedProbe);
  if (inFlight) return inFlight;
  inFlight = probeWebGpuCapability().then((result) => {
    cachedProbe = result;
    inFlight = null;
    return result;
  });
  return inFlight;
}

export function resetWebGpuCapabilityProbe(): void {
  cachedProbe = null;
  inFlight = null;
}

/**
 * On-demand, local-only runtime capability report.
 *
 * This is deliberately a diagnostic snapshot rather than a fingerprint or a
 * render-policy input. Static API presence and bounded dynamic probes are
 * reported separately. Probe failures are represented by stable status codes;
 * browser exception text, user-agent strings, document data, and file names
 * never leave this module.
 */

import { getPlatformInfo } from '@varve/platform';
import { detectPlatformCapabilities, type PlatformCapabilities } from '../canvas/adaptiveProfile';
import {
  type OffscreenProbeDetail,
  probeOffscreenCapability,
} from '../render/offscreenCapabilityProbe';
import { ensureWebGpuCapabilityProbe } from './webGpuProbe';

export type { WebGpuCapabilityProbe } from './webGpuProbe';

export const CAPABILITY_REPORT_SCHEMA_VERSION = 1 as const;

export type CapabilityProbeStatus = 'supported' | 'unavailable' | 'failed';

export interface WebGlCapabilityProbe {
  apiPresent: boolean;
  contextCreated: boolean;
  contextKind: 'webgl2' | 'webgl' | null;
  contextReleased: boolean;
  status: CapabilityProbeStatus;
}

export interface WasmCapabilityProbe {
  apiPresent: boolean;
  baselineValidated: boolean;
  simdValidated: boolean;
  threadsValidated: boolean;
  threadsUsable: boolean;
}

export interface StorageCapabilityProbe {
  indexedDbPresent: boolean;
  storageManagerPresent: boolean;
  estimateStatus: CapabilityProbeStatus;
  usageBytes?: number;
  quotaBytes?: number;
  persistedStatus: CapabilityProbeStatus;
  persisted?: boolean;
}

export interface FileCapabilityProbe {
  fileSystemAccessApi: boolean;
  fileInputFallback: boolean;
  blobDownload: boolean;
  clipboardImageRead: boolean;
  localFontQuery: boolean;
}

export interface CapabilityReport {
  schemaVersion: typeof CAPABILITY_REPORT_SCHEMA_VERSION;
  collectedAt: string;
  runtime: {
    kind: ReturnType<typeof getPlatformInfo>['kind'];
    os: ReturnType<typeof getPlatformInfo>['os'];
    secureContext: boolean;
    crossOriginIsolated: boolean;
    visibilityState: string;
    documentWasDiscarded: boolean;
    viewportCss: { width: number; height: number };
    devicePixelRatio: number;
  };
  platform: {
    capabilities: readonly string[];
    hasTauriIpc: boolean;
    hasNativeFs: boolean;
    hasWebGpu: boolean;
    hasWebWorker: boolean;
    hasWasm: boolean;
  };
  adaptiveProfile: PlatformCapabilities;
  graphics: {
    webgl: WebGlCapabilityProbe;
    webgpu: WebGpuCapabilityProbe;
  };
  worker: {
    workerApiPresent: boolean;
    offscreenCanvasApiPresent: boolean;
    createImageBitmapApiPresent: boolean;
    offscreen: Pick<
      OffscreenProbeDetail,
      'capability' | 'stage' | 'durationMs' | 'mainThreadPixelsVerified'
    >;
  };
  wasm: WasmCapabilityProbe;
  storage: StorageCapabilityProbe;
  files: FileCapabilityProbe;
}

const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 15, 11,
]);

// A one-page shared memory declaration is enough to validate the threads
// feature without starting a worker or allocating a meaningful buffer.
const WASM_THREADS_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 1, 3, 1, 1]);

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function hasFunction(value: unknown): boolean {
  return typeof value === 'function';
}

function getNavigatorRecord(): Record<string, unknown> {
  return typeof navigator === 'undefined' ? {} : (navigator as unknown as Record<string, unknown>);
}

function getWindowRecord(): Record<string, unknown> {
  return typeof window === 'undefined' ? {} : (window as unknown as Record<string, unknown>);
}

function probeWebGl(): WebGlCapabilityProbe {
  const apiPresent =
    typeof WebGLRenderingContext !== 'undefined' || typeof WebGL2RenderingContext !== 'undefined';
  if (typeof document === 'undefined') {
    return {
      apiPresent,
      contextCreated: false,
      contextKind: null,
      contextReleased: false,
      status: 'unavailable',
    };
  }

  try {
    const canvas = document.createElement('canvas');
    const webgl2 = canvas.getContext('webgl2');
    const context = webgl2 ?? canvas.getContext('webgl');
    if (!context) {
      return {
        apiPresent,
        contextCreated: false,
        contextKind: null,
        contextReleased: false,
        status: apiPresent ? 'failed' : 'unavailable',
      };
    }
    let contextReleased = false;
    try {
      (
        context as unknown as {
          getExtension?: (name: string) => { loseContext?: () => void } | null;
        }
      )
        .getExtension?.('WEBGL_lose_context')
        ?.loseContext?.();
      contextReleased = true;
    } catch {
      // The context was created; cleanup is best effort in older engines.
    }
    return {
      apiPresent: true,
      contextCreated: true,
      contextKind: webgl2 ? 'webgl2' : 'webgl',
      contextReleased,
      status: 'supported',
    };
  } catch {
    return {
      apiPresent,
      contextCreated: false,
      contextKind: null,
      contextReleased: false,
      status: 'failed',
    };
  }
}

function validateWasm(bytes: Uint8Array): boolean {
  if (typeof WebAssembly === 'undefined' || !hasFunction(WebAssembly.validate)) return false;
  try {
    return WebAssembly.validate(bytes as unknown as BufferSource);
  } catch {
    return false;
  }
}

function probeWasm(): WasmCapabilityProbe {
  const apiPresent = typeof WebAssembly !== 'undefined' && hasFunction(WebAssembly.validate);
  const baselineValidated = apiPresent
    ? validateWasm(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
    : false;
  const simdValidated = apiPresent ? validateWasm(WASM_SIMD_PROBE) : false;
  const threadsValidated = apiPresent ? validateWasm(WASM_THREADS_PROBE) : false;
  const crossOriginIsolated = Boolean(getWindowRecord().crossOriginIsolated);
  return {
    apiPresent,
    baselineValidated,
    simdValidated,
    threadsValidated,
    threadsUsable:
      threadsValidated && typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated,
  };
}

async function probeStorage(): Promise<StorageCapabilityProbe> {
  const nav = getNavigatorRecord();
  const storage = nav.storage as
    | {
        estimate?: () => Promise<{ usage?: unknown; quota?: unknown }>;
        persisted?: () => Promise<boolean>;
      }
    | undefined;
  const report: StorageCapabilityProbe = {
    indexedDbPresent: typeof indexedDB !== 'undefined',
    storageManagerPresent: storage !== undefined,
    estimateStatus: storage && hasFunction(storage.estimate) ? 'failed' : 'unavailable',
    persistedStatus: storage && hasFunction(storage.persisted) ? 'failed' : 'unavailable',
  };

  if (storage && hasFunction(storage.estimate)) {
    try {
      const estimateFn = storage.estimate;
      if (!estimateFn) return report;
      const estimate = await estimateFn();
      report.usageBytes = finiteNumber(estimate.usage);
      report.quotaBytes = finiteNumber(estimate.quota);
      report.estimateStatus = 'supported';
    } catch {
      report.estimateStatus = 'failed';
    }
  }
  if (storage && hasFunction(storage.persisted)) {
    try {
      const persistedFn = storage.persisted;
      if (!persistedFn) return report;
      report.persisted = await persistedFn();
      report.persistedStatus = 'supported';
    } catch {
      report.persistedStatus = 'failed';
    }
  }
  return report;
}

function probeFiles(): FileCapabilityProbe {
  const nav = getNavigatorRecord();
  const win = getWindowRecord();
  const clipboard = nav.clipboard as { read?: unknown } | undefined;
  return {
    fileSystemAccessApi: hasFunction(win.showOpenFilePicker) && hasFunction(win.showSaveFilePicker),
    fileInputFallback: typeof document !== 'undefined',
    blobDownload:
      typeof Blob !== 'undefined' && typeof URL !== 'undefined' && hasFunction(URL.createObjectURL),
    clipboardImageRead: hasFunction(clipboard?.read),
    localFontQuery: hasFunction(win.queryLocalFonts),
  };
}

function snapshotOffscreen(detail: OffscreenProbeDetail): CapabilityReport['worker']['offscreen'] {
  return {
    capability: detail.capability,
    stage: detail.stage,
    durationMs: finiteNumber(detail.durationMs),
    mainThreadPixelsVerified: detail.mainThreadPixelsVerified,
  };
}

function snapshotRuntime(): CapabilityReport['runtime'] {
  const win = getWindowRecord();
  const doc = typeof document === 'undefined' ? undefined : document;
  const viewportWidth = finiteNumber(win.innerWidth) ?? 0;
  const viewportHeight = finiteNumber(win.innerHeight) ?? 0;
  const devicePixelRatio = finiteNumber(win.devicePixelRatio) ?? 1;
  return {
    kind: getPlatformInfo().kind,
    os: getPlatformInfo().os,
    secureContext: Boolean(win.isSecureContext),
    crossOriginIsolated: Boolean(win.crossOriginIsolated),
    visibilityState: doc?.visibilityState ?? 'unknown',
    documentWasDiscarded: Boolean(
      doc && (doc as Document & { wasDiscarded?: boolean }).wasDiscarded,
    ),
    viewportCss: { width: viewportWidth, height: viewportHeight },
    devicePixelRatio,
  };
}

/** Collect one bounded capability snapshot. It never uploads or mutates storage. */
export async function collectCapabilityReport(): Promise<CapabilityReport> {
  const platform = getPlatformInfo();
  const adaptiveProfile = detectPlatformCapabilities();
  const offscreenPromise = probeOffscreenCapability();
  const [webgpu, offscreen, storage] = await Promise.all([
    ensureWebGpuCapabilityProbe(),
    offscreenPromise,
    probeStorage(),
  ]);
  const webgl = probeWebGl();
  const wasm = probeWasm();

  return {
    schemaVersion: CAPABILITY_REPORT_SCHEMA_VERSION,
    collectedAt: new Date().toISOString(),
    runtime: snapshotRuntime(),
    platform: {
      capabilities: [...platform.capabilities].sort(),
      hasTauriIpc: platform.hasTauriIpc,
      hasNativeFs: platform.hasNativeFs,
      hasWebGpu: platform.hasWebGpu,
      hasWebWorker: platform.hasWebWorker,
      hasWasm: platform.hasWasm,
    },
    adaptiveProfile: { ...adaptiveProfile },
    graphics: { webgl, webgpu },
    worker: {
      workerApiPresent: typeof Worker !== 'undefined',
      offscreenCanvasApiPresent: typeof OffscreenCanvas !== 'undefined',
      createImageBitmapApiPresent: typeof createImageBitmap === 'function',
      offscreen: snapshotOffscreen(offscreen),
    },
    wasm,
    storage,
    files: probeFiles(),
  };
}

export function serializeCapabilityReport(report: CapabilityReport): string {
  return JSON.stringify(report, null, 2);
}

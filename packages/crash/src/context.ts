/**
 * Minimal crash context collection.
 *
 * Collects only the required-minimized release/runtime fields. No paths, no
 * usernames, no document identifiers. Memory pressure is a broad category
 * derived from the JS heap when available; never a memory dump.
 */

import type {
  CrashReleaseMetadata,
  CrashRuntimeMetadata,
  MemoryPressure,
  RuntimeKind,
} from './schema';

export interface CrashContextInput {
  appVersion: string;
  buildChannel: 'dev' | 'nightly' | 'beta' | 'production';
  releaseId: string;
  documentSchemaVersion: number;
  runtime: RuntimeKind;
  osFamily?: CrashRuntimeMetadata['osFamily'];
  osVersionRange?: string;
  arch?: CrashRuntimeMetadata['arch'];
  rendererBackend?: CrashRuntimeMetadata['rendererBackend'];
  tauriVersion?: string;
  frontendBundleVersion?: string;
  gitCommit?: string;
}

/** Broad OS-family and version-range from the user agent (no user data). */
export function detectOsFromUserAgent(userAgent: string): {
  osFamily: CrashRuntimeMetadata['osFamily'];
  osVersionRange?: string;
} {
  if (/windows nt/i.test(userAgent)) {
    const match = /windows nt (\d+\.\d+)/i.exec(userAgent);
    const version = match?.[1] ? Number(match[1]) : undefined;
    let range: string | undefined;
    if (version !== undefined) {
      if (version >= 10) range = '10+';
      else if (version >= 6.2) range = '8';
      else if (version >= 6.1) range = '7';
      else range = 'older';
    }
    return { osFamily: 'windows', osVersionRange: range };
  }
  if (/mac os x|macintosh/i.test(userAgent)) {
    const match = /mac os x (\d+[._]\d+)/i.exec(userAgent);
    return {
      osFamily: 'macos',
      osVersionRange: match ? `${match[1]?.replace('_', '.')}+` : undefined,
    };
  }
  if (/android/i.test(userAgent)) return { osFamily: 'android' };
  if (/iphone|ipad|ios/i.test(userAgent)) return { osFamily: 'ios' };
  if (/linux|x11/i.test(userAgent)) return { osFamily: 'linux' };
  return { osFamily: 'unknown' };
}

export function detectArch(): CrashRuntimeMetadata['arch'] {
  const ua = navigator.userAgent;
  if (/arm64|aarch64/i.test(ua)) return 'arm64';
  if (/wasm32/i.test(ua)) return 'wasm32';
  if (/x86_64|wow64|amd64/i.test(ua)) return 'x64';
  if (/i686|i386/i.test(ua)) return 'ia32';
  return 'unknown';
}

/** Broad memory-pressure category from the JS heap, when available. */
export function detectMemoryPressure(): MemoryPressure {
  try {
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
      }
    ).memory;
    if (!memory?.usedJSHeapSize || !memory.jsHeapSizeLimit) return 'unknown';
    const ratio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
    if (ratio > 0.9) return 'critical';
    if (ratio > 0.7) return 'high';
    if (ratio > 0.4) return 'medium';
    return 'low';
  } catch {
    return 'unknown';
  }
}

/** Builds the release + runtime blocks from minimal inputs. */
export function collectCrashContext(input: CrashContextInput): {
  release: CrashReleaseMetadata;
  runtime: CrashRuntimeMetadata;
} {
  const os = input.osFamily
    ? { osFamily: input.osFamily, osVersionRange: input.osVersionRange }
    : detectOsFromUserAgent(navigator.userAgent);
  return {
    release: {
      appVersion: input.appVersion,
      buildChannel: input.buildChannel,
      releaseId: input.releaseId,
      documentSchemaVersion: input.documentSchemaVersion,
      tauriVersion: input.tauriVersion,
      frontendBundleVersion: input.frontendBundleVersion,
      gitCommit: input.gitCommit,
    },
    runtime: {
      runtime: input.runtime,
      osFamily: os.osFamily,
      osVersionRange: os.osVersionRange,
      arch: input.arch ?? detectArch(),
      memoryPressure: detectMemoryPressure(),
      rendererBackend: input.rendererBackend ?? 'unknown',
    },
  };
}

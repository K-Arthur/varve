/**
 * Release metadata for crash reports.
 *
 * Production builds stamp `window.__VARVE_RELEASE__` via Vite `define`
 * (see apps/desktop/vite.config.ts). Unstamped builds (dev, tests) report
 * the `dev` channel with the package version — never a fabricated
 * production release id.
 */

import type { BuildChannel } from '@varve/crash';
import { CURRENT_DOCUMENT_VERSION } from '@varve/scene';

declare global {
  interface Window {
    __VARVE_RELEASE__?: {
      appVersion?: string;
      buildChannel?: BuildChannel;
      releaseId?: string;
      gitCommit?: string;
    };
  }
}

export interface ReleaseInfo {
  appVersion: string;
  buildChannel: BuildChannel;
  releaseId: string;
  gitCommit?: string;
}

export function getReleaseInfo(): ReleaseInfo {
  const stamp = typeof window !== 'undefined' ? window.__VARVE_RELEASE__ : undefined;
  const channel: BuildChannel =
    stamp?.buildChannel === 'nightly' ||
    stamp?.buildChannel === 'beta' ||
    stamp?.buildChannel === 'production'
      ? stamp.buildChannel
      : 'dev';
  return {
    appVersion: stamp?.appVersion ?? '0.1.0',
    buildChannel: channel,
    releaseId: stamp?.releaseId ?? 'dev-unstamped',
    gitCommit: stamp?.gitCommit,
  };
}

/** Maps the scene's CURRENT_DOCUMENT_VERSION string to a schema number. */
export function documentSchemaVersion(formatVersion: string): number {
  const [major = '0', minor = '0'] = formatVersion.split('.');
  return Number(major) * 1000 + Number(minor);
}

/** Current document schema version for crash reports. */
export function currentDocumentSchemaVersion(): number {
  return documentSchemaVersion(CURRENT_DOCUMENT_VERSION);
}

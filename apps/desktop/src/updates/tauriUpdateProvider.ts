import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  type DownloadEvent,
  type Update as TauriUpdate,
  check as tauriCheck,
} from '@tauri-apps/plugin-updater';
import type {
  DownloadedUpdate,
  DownloadProgress,
  PackagingContext,
  UpdateChannel,
  UpdateInfo,
  UpdateProvider,
  VerifiedUpdate,
} from '@varve/editor';

interface NativePackagingContext {
  platform: PackagingContext['platform'];
  architecture: PackagingContext['architecture'];
  packageType: PackagingContext['packageType'];
  currentVersion: string;
  channel: UpdateChannel;
  updateAuthority: PackagingContext['updateAuthority'];
  installLocation: PackagingContext['installLocation'];
  runtimeSupported: boolean;
  buildLabel: string;
}

interface DownloadToken extends DownloadedUpdate {
  readonly updateVersion: string;
}

interface VerifyToken extends VerifiedUpdate {
  readonly updateVersion: string;
}

/**
 * Narrow frontend/native boundary. Tauri owns the downloaded bytes and the
 * signature check; the browser receives only opaque lifecycle tokens.
 */
export class TauriUpdateProvider implements UpdateProvider {
  private nativeUpdate: TauriUpdate | null = null;

  async getPackagingContext(): Promise<PackagingContext> {
    const native = await invoke<NativePackagingContext>('update_packaging_context');
    // Version from Tauri is authoritative when the native command is mocked or
    // unavailable in a test harness; it is never used to select an artifact.
    const currentVersion = native.currentVersion || (await getVersion());
    return { ...native, currentVersion };
  }

  async check(channel: UpdateChannel): Promise<UpdateInfo | null> {
    if (channel !== 'stable') {
      throw {
        code: 'unsupported-build',
        message: `The ${channel} update channel is not enabled in this build.`,
      };
    }
    const update = await tauriCheck({ allowDowngrades: false, timeout: 15_000 });
    this.nativeUpdate = update;
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? null,
      publishedAt: update.date ?? null,
      channel,
      target: targetFromMetadata(update),
    };
  }

  async download(
    update: UpdateInfo,
    onProgress: (progress: DownloadProgress) => void,
  ): Promise<DownloadedUpdate> {
    if (!this.nativeUpdate || this.nativeUpdate.version !== update.version) {
      throw { code: 'busy', message: 'The native update handle is no longer available.' };
    }
    let downloadedBytes = 0;
    const onEvent = (event: DownloadEvent) => {
      if (event.event === 'Started') {
        onProgress({ downloadedBytes: 0, totalBytes: event.data.contentLength ?? null });
      } else if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength;
        onProgress({ downloadedBytes, totalBytes: null });
      }
      // `Update.download()` resolves only after Tauri has verified the bytes
      // against the embedded public key. Finished is therefore a verified
      // download boundary, not merely a transport boundary.
    };
    await this.nativeUpdate.download(onEvent, { timeout: 10 * 60_000 });
    return { __brand: 'DownloadedUpdate', updateVersion: update.version } as DownloadToken;
  }

  async verify(download: DownloadedUpdate, update: UpdateInfo): Promise<VerifiedUpdate> {
    const token = download as DownloadToken;
    if (token.updateVersion !== update.version) {
      throw {
        code: 'invalid-signature',
        message: 'The verified update identity does not match the manifest.',
      };
    }
    return { __brand: 'VerifiedUpdate', updateVersion: update.version } as VerifyToken;
  }

  async install(verified: VerifiedUpdate, update: UpdateInfo): Promise<void> {
    const token = verified as VerifyToken;
    if (token.updateVersion !== update.version || !this.nativeUpdate) {
      throw {
        code: 'install-failed',
        message: 'The verified update handle is no longer available.',
      };
    }
    await this.nativeUpdate.install();
    this.nativeUpdate = null;
  }

  async relaunch(): Promise<void> {
    await relaunch();
  }
}

function targetFromMetadata(update: TauriUpdate): string {
  const platforms = update.rawJson.platforms;
  if (!platforms || typeof platforms !== 'object') return 'unknown';
  const target = Object.keys(platforms as Record<string, unknown>)[0];
  return target ?? 'unknown';
}

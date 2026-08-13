/**
 * Consent-first update contracts. The provider owns platform-specific update
 * handles; the editor only sees opaque downloaded/verified values.
 */

export type UpdateAuthority =
  | 'self-managed'
  | 'package-manager-managed'
  | 'store-managed'
  | 'manual-only'
  | 'development-build'
  | 'unsupported';

export type UpdatePlatform = 'linux' | 'windows' | 'darwin' | 'unknown';
export type UpdateArchitecture = 'x86_64' | 'aarch64' | 'i686' | 'armv7' | 'unknown';
export type UpdatePackageType = 'appimage' | 'deb' | 'rpm' | 'nsis' | 'dmg-app' | 'unknown';
export type UpdateChannel = 'stable' | 'beta' | 'nightly';

export interface PackagingContext {
  platform: UpdatePlatform;
  architecture: UpdateArchitecture;
  packageType: UpdatePackageType;
  currentVersion: string;
  channel: UpdateChannel;
  updateAuthority: UpdateAuthority;
  /** `translocated` = macOS Gatekeeper quarantine copy; never an update target. */
  installLocation: 'writable' | 'not-writable' | 'translocated' | 'unknown';
  /** True only when the native adapter has verified the runtime package. */
  runtimeSupported: boolean;
  /** Human-readable build label, e.g. `x86_64 AppImage`. */
  buildLabel: string;
}

export type UpdateConsent = 'manual' | 'notify' | 'download-automatically';

export interface UpdatePreferences {
  schemaVersion: 1;
  /** Prevents a declined first-run prompt from becoming a launch nag. */
  consentPromptSeen: boolean;
  consent: UpdateConsent;
  installOnQuit: boolean;
  channel: UpdateChannel;
  skippedVersions: Partial<Record<UpdateChannel, string>>;
  lastCheckedAt: number | null;
  nextEligibleCheckAt: number | null;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
  publishedAt: string | null;
  channel: UpdateChannel;
  target: string;
}

export type UpdateErrorCode =
  | 'network'
  | 'no-update'
  | 'invalid-metadata'
  | 'invalid-version'
  | 'invalid-signature'
  | 'package-mismatch'
  | 'architecture-mismatch'
  | 'unsupported-build'
  | 'permission-denied'
  | 'disk-full'
  | 'download-failed'
  | 'download-cancelled'
  | 'install-failed'
  | 'restart-failed'
  | 'package-manager-managed'
  | 'busy'
  | 'unsaved-documents'
  | 'endpoint-unavailable'
  | 'unknown';

export interface UpdateError {
  code: UpdateErrorCode;
  message: string;
  /** Safe diagnostics only; providers must redact credentials and paths. */
  detail?: string;
}

export type UpdateState =
  | { kind: 'consent-required' }
  | { kind: 'disabled' }
  | { kind: 'idle' }
  | { kind: 'checking'; source: 'manual' | 'background' }
  | { kind: 'up-to-date'; checkedAt: number }
  | { kind: 'update-available'; update: UpdateInfo }
  | { kind: 'downloading'; update: UpdateInfo; downloadedBytes: number; totalBytes: number | null }
  | { kind: 'verifying'; update: UpdateInfo }
  | { kind: 'ready-to-install'; update: UpdateInfo }
  | { kind: 'installing'; update: UpdateInfo }
  | { kind: 'restart-required'; update: UpdateInfo }
  | { kind: 'deferred'; update: UpdateInfo }
  | { kind: 'cancelled'; update?: UpdateInfo }
  | { kind: 'error'; error: UpdateError; update?: UpdateInfo }
  | { kind: 'unsupported'; reason: UpdateError }
  | {
      kind: 'externally-managed';
      authority: Extract<UpdateAuthority, 'package-manager-managed' | 'store-managed'>;
    };

export type UpdateAction =
  | { type: 'check-started'; source: 'manual' | 'background' }
  | { type: 'no-update'; checkedAt: number }
  | { type: 'update-found'; update: UpdateInfo }
  | { type: 'download-started'; totalBytes: number | null }
  | { type: 'download-progress'; downloadedBytes: number }
  | { type: 'download-finished' }
  | { type: 'verification-succeeded' }
  | { type: 'install-started' }
  | { type: 'install-succeeded' }
  | { type: 'defer' }
  | { type: 'cancel' }
  | { type: 'failed'; error: UpdateError };

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
}

/** Opaque values deliberately prevent the UI from choosing an executable path. */
export interface DownloadedUpdate {
  readonly __brand: 'DownloadedUpdate';
}

export interface VerifiedUpdate {
  readonly __brand: 'VerifiedUpdate';
}

export interface UpdateProvider {
  getPackagingContext(): Promise<PackagingContext>;
  check(channel: UpdateChannel): Promise<UpdateInfo | null>;
  download(
    update: UpdateInfo,
    onProgress: (progress: DownloadProgress) => void,
  ): Promise<DownloadedUpdate>;
  verify(download: DownloadedUpdate, update: UpdateInfo): Promise<VerifiedUpdate>;
  install(verified: VerifiedUpdate, update: UpdateInfo): Promise<void>;
  /** Relaunch only after install and the canonical termination guard succeed. */
  relaunch(): Promise<void>;
}

export interface UpdatePreferencesStore {
  load(): UpdatePreferences;
  save(preferences: UpdatePreferences): void;
}

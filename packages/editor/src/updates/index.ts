export {
  UpdateCoordinatorProvider,
  useOptionalUpdateCoordinator,
  useUpdateCoordinator,
} from './UpdateContext';
export { type UpdateClock, UpdateCoordinator } from './updateCoordinator';
export {
  authorityState,
  canBackgroundCheck,
  canDownloadAutomatically,
  canInstallOnQuit,
  compareVersions,
  DEFAULT_UPDATE_PREFERENCES,
  isChannelMatch,
  isCheckDue,
  normalizeUpdatePreferences,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FAILURE_BACKOFF_MS,
} from './updatePolicy';
export { transitionUpdateState } from './updateStateMachine';
export type {
  DownloadedUpdate,
  DownloadProgress,
  PackagingContext,
  UpdateAction,
  UpdateArchitecture,
  UpdateAuthority,
  UpdateChannel,
  UpdateConsent,
  UpdateError,
  UpdateErrorCode,
  UpdateInfo,
  UpdatePackageType,
  UpdatePlatform,
  UpdatePreferences,
  UpdatePreferencesStore,
  UpdateProvider,
  UpdateState,
  VerifiedUpdate,
} from './updateTypes';
export type {
  UpdateLease,
  UpdateWindowOperation,
  WindowSyncMessage,
  WindowSyncTransport,
} from './updateWindowSync';
export {
  BroadcastWindowSync,
  claimOperationLease,
  hasActiveOperationLease,
  isActiveUpdateState,
  isSettledUpdateState,
  releaseOperationLease,
  renewOperationLease,
  UPDATE_ACTIVE_STALE_MS,
  UPDATE_LEASE_KEY,
  UPDATE_LEASE_TTL_MS,
} from './updateWindowSync';

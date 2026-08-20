import './workspace/bootstrap';

export {
  configureDesktopAnalytics,
  getDesktopAnalytics,
  resetDesktopAnalyticsForTests,
  startDesktopFlushTimer,
  stopDesktopFlushTimer,
  updateDesktopAnalyticsConsent,
} from './analytics/desktopAnalytics';
export { type ReplayExpansion, worldRectsToScreen } from './canvas/dirtyQuery';
export {
  computeDocumentDirtyRegion,
  type DirtyRectReason,
  type DirtyRectRecord,
  type DirtyRegion,
  type DirtyRegionRecorder,
} from './canvas/dirtyRegion';
export {
  type DirtyMergePolicy,
  type DirtyMergeResult,
  mergeDirtyRects,
} from './canvas/dirtyRegionMerge';
export type {
  CapabilityRestrictions,
  RestrictedCapability,
} from './capabilities/restrictions';
export {
  getCapabilityRestrictions,
  isCapabilityRestricted,
  RESTRICTION_MESSAGES,
  setCapabilityRestrictions,
} from './capabilities/restrictions';
export { ErrorBoundary } from './components/ErrorBoundary';
export { SettingsProvider } from './components/Settings/SettingsContext';
export type { SettingsDialogProps } from './components/Settings/SettingsDialog';
export { SettingsDialog } from './components/Settings/SettingsDialog';
export type { EditorContextValue, EditorState, SessionMeta, ToolId } from './context';
export { EditorProvider, useEditor } from './context';
export type { CrashCenterProps, CrashTestHooks } from './crash';
export {
  CrashCenter,
  currentDocumentSchemaVersion,
  installCrashTestHooks,
  openPrivacySettings,
  PrivacyDiagnosticsSection,
  SafeModeScreen,
} from './crash';
export type {
  DialogOutcome,
  PromptKind,
  PromptRequest,
  SaveFailureCategory,
  TerminationIntent,
  TerminationState,
} from './lifecycle';
export {
  getLifecycleCommitHook,
  getLifecycleCoordinator,
  getLifecycleFinalizeHandler,
  LifecycleProvider,
  setLifecycleCommitHook,
  setLifecycleFinalizeHandler,
} from './lifecycle';
// Onboarding state — exposed so a host can declare first-run already handled
// (the browser demo explains itself through its own banner).
export { TIPS } from './onboard/DidYouKnow/tips';
export { workspaceTips } from './onboard/DidYouKnow/workspaceTips';
export { MICRO_HINTS } from './onboard/MicroHints/microHintsData';
export { CHECKLIST_ITEMS } from './onboard/OnboardingChecklist/OnboardingChecklist';
export type { OnboardingStore } from './onboard/onboardingStore';
export {
  loadOnboardingState,
  markOnboardingComplete,
  saveOnboardingState,
} from './onboard/onboardingStore';
export type { PackageExportResult, PackageManifest } from './packageExport';
export { buildPackageExport } from './packageExport';
export type {
  FrameJob,
  FrameLane,
  FrameScheduler,
  FrameSchedulerDiagnostics,
  FrameSchedulerOptions,
} from './performance/frameScheduler';
export { createFrameScheduler } from './performance/frameScheduler';
export type {
  PerformanceCollector,
  PerformanceCollectorOptions,
} from './performance/performanceCollector';
export { createPerformanceCollector } from './performance/performanceCollector';
export type {
  SoakHarnessOptions,
  SoakPlateau,
  SoakResourceSnapshot,
  SoakResult,
} from './performance/soakHarness';
export { runDeterministicSoak } from './performance/soakHarness';
export type {
  PerformanceWorkload,
  PerformanceWorkloadId,
  WorkloadPointerSample,
  WorkloadViewport,
} from './performance/workloadCorpus';
export {
  createPerformanceWorkload,
  createPerformanceWorkloadCorpus,
  PERFORMANCE_WORKLOAD_IDS,
  PERFORMANCE_WORKLOAD_VERSION,
} from './performance/workloadCorpus';
export { SelectionOverlay } from './SelectionOverlay';
export type { OpenFileRequest, ShellProps } from './Shell';
export { Shell } from './Shell';
export { loadSettings, updateSettings } from './settings';
export { formatShortcut, SHORTCUT_DEFS, useShortcuts } from './shortcuts';
export type { StartupCapabilities } from './startup/capabilityCheck';
export { checkStartupCapabilities } from './startup/capabilityCheck';
export type {
  StartupMark,
  StartupMilestone,
  StartupTimelineExport,
  StartupTimer,
} from './startup/startupTimer';
export { createStartupTimer, STARTUP_MILESTONES } from './startup/startupTimer';
export type { UseStartupOptions, UseStartupResult } from './startup/useStartup';
export { useStartup } from './startup/useStartup';
export type { VisibleSurfaceOptions } from './startup/visibleSurface';
export { afterFirstVisiblePaint } from './startup/visibleSurface';
export { TabStrip } from './TabStrip';
export type {
  DownloadedUpdate,
  DownloadProgress,
  PackagingContext,
  UpdateAction,
  UpdateArchitecture,
  UpdateAuthority,
  UpdateChannel,
  UpdateClock,
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
} from './updates';
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
  transitionUpdateState,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FAILURE_BACKOFF_MS,
  UpdateCoordinator,
  UpdateCoordinatorProvider,
  useOptionalUpdateCoordinator,
  useUpdateCoordinator,
} from './updates';

import './workspace/bootstrap';

export { ErrorBoundary } from './components/ErrorBoundary';
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

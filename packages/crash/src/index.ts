export type { BreadcrumbSink } from './breadcrumbs';
export { NOOP_BREADCRUMB_SINK, RingBreadcrumbBuffer } from './breadcrumbs';
export type { CrashCapabilities } from './capabilities';
export { detectCrashCapabilities } from './capabilities';
export type {
  ConsentAction,
  ConsentProvider,
  ConsentScope,
  CrashConsentRecord,
  CrashConsentState,
  CrashConsentStorage,
} from './consent';
export {
  applyConsentDecision,
  CRASH_CONSENT_POLICY_VERSION,
  CRASH_CONSENT_STORAGE_KEY,
  CrashConsentProvider,
  canAsk,
  canUpload,
  isPolicyLocked,
  LEGACY_CRASH_CONSENT_STORAGE_KEY,
  LocalStorageCrashConsentStorage,
  MemoryCrashConsentStorage,
  transitionConsent,
  unknownConsent,
} from './consent';
export type { CrashContextInput } from './context';
export {
  collectCrashContext,
  detectArch,
  detectMemoryPressure,
  detectOsFromUserAgent,
} from './context';
export type { CrashLoopState, CrashLoopStore } from './crashLoop';
export {
  CRASH_LOOP_STORAGE_KEY,
  CRASH_LOOP_THRESHOLD,
  CRASH_LOOP_WINDOW_MS,
  isInCrashLoop,
  LocalStorageCrashLoopStore,
  MemoryCrashLoopStore,
  recordCleanStartup,
  recordStartupFailure,
  resetCrashLoop,
} from './crashLoop';
export { computeGroupFingerprint, fnv1a, groupByFingerprint } from './fingerprint';
export type { IngestionResult } from './ingestion';
export { INGESTION_MAX_PAYLOAD_BYTES, validateReportForIngestion } from './ingestion';
export type { CrashMetricEvent, CrashMetrics, CrashMetricsState } from './metrics';
export { EMPTY_METRICS, LocalCrashMetrics } from './metrics';
export type {
  CrashReportStorage,
  EnqueueResult,
  IndexedDbOptions,
  NativeFsCrashReportStorageOptions,
} from './queue';
export {
  CrashReportQueue,
  IndexedDbCrashReportStorage,
  MemoryCrashReportStorage,
  NativeFsCrashReportStorage,
} from './queue';
export type { SanitizeOptions } from './redact';
export {
  parseStack,
  parseStackFrame,
  redactText,
  sanitizeCrashReport,
  sanitizeStackLine,
  toUploadPayload,
  truncate,
} from './redact';
export type { SafeModeOptions, SafeModeState, SafeModeStore } from './safeMode';
export {
  DEFAULT_SAFE_MODE_OPTIONS,
  enterSafeMode,
  exitSafeMode,
  isInSafeMode,
  LocalStorageSafeModeStore,
  MemorySafeModeStore,
  SAFE_MODE_STORAGE_KEY,
  updateSafeModeOptions,
} from './safeMode';
export type {
  CrashAttachment,
  CrashAttachmentKind,
  CrashBreadcrumb,
  CrashMetadata,
  CrashReleaseMetadata,
  CrashReport,
  CrashReportFieldClass,
  CrashRuntimeMetadata,
  CrashStackFrame,
  CrashThreadCategory,
  CrashType,
  MemoryPressure,
  RecoveryStatus,
  RuntimeKind,
  ValidationIssue,
} from './schema';
export {
  CRASH_REPORT_SCHEMA_VERSION,
  CRUMB_EVENT_PATTERN,
  FIELD_CLASSIFICATION,
  isKnownCrumbEvent,
  isValidCrashReport,
  KNOWN_CRUMB_PREFIXES,
  LIMITS,
  validateCrashReport,
} from './schema';
export type { BuildChannel, CrashServiceDeps, RawCaptureInput } from './service';
export { CrashReportService } from './service';
export type { CrashUploader, CrashUploadResult, HttpCrashUploaderOptions } from './uploader';
export {
  backoffDelayMs,
  HttpCrashUploader,
  isMeteredConnection,
  NoopCrashUploader,
} from './uploader';

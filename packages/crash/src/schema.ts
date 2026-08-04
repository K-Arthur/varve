/**
 * Versioned crash-report schema and data-classification contract.
 *
 * Every field in a crash report is classified:
 *   - 'required-minimized': needed to triage; always present.
 *   - 'optional': only present when the user opted into extended diagnostics.
 *   - 'attachment': never included unless the user explicitly attaches it.
 *   - 'local-only': used for queue bookkeeping, stripped before upload.
 *
 * Prohibited data (never collected by any path):
 * canvas screenshots, window screenshots, screen recordings, document
 * contents, layer/page/component names, user-entered design text, imported
 * images, exported output, clipboard data, full filesystem paths, usernames
 * in paths, home-directory paths, network share paths, recent-file names,
 * email addresses (except an explicitly user-provided contact field),
 * IP addresses as identifiers, precise location, stable hardware
 * fingerprints, advertising identifiers, full URLs with query strings,
 * access tokens, authorization headers, cookies, API keys, environment
 * secrets, model prompts, full memory dumps, arbitrary browser storage,
 * raw console history, unbounded application logs.
 *
 * Unknown fields are rejected at the reporting boundary by
 * `validateCrashReport`; `redactCrashReport` never passes them through.
 */

export const CRASH_REPORT_SCHEMA_VERSION = 1;

export type CrashReportFieldClass = 'required-minimized' | 'optional' | 'attachment' | 'local-only';

export type CrashType =
  | 'error'
  | 'unhandledrejection'
  | 'react'
  | 'worker'
  | 'wasm'
  | 'rust-panic'
  | 'contextlost'
  | 'oom'
  | 'hang'
  | 'fatal'
  | 'unknown';

export type CrashThreadCategory = 'main' | 'worker' | 'render' | 'native' | 'wasm' | 'unknown';

export type RuntimeKind = 'tauri' | 'browser' | 'webview2' | 'webkitgtk' | 'wkwebview';

export type MemoryPressure = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export type RecoveryStatus = 'recovered' | 'not-recovered' | 'not-applicable';

export interface CrashReleaseMetadata {
  appVersion: string;
  buildChannel: 'dev' | 'nightly' | 'beta' | 'production';
  releaseId: string;
  gitCommit?: string;
  tauriVersion?: string;
  frontendBundleVersion?: string;
  documentSchemaVersion: number;
}

export interface CrashRuntimeMetadata {
  runtime: RuntimeKind;
  osFamily: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown';
  /** Broad range only, e.g. '10+', '11-13', '6.0+'. Never a full version. */
  osVersionRange?: string;
  arch: 'x64' | 'arm64' | 'ia32' | 'wasm32' | 'unknown';
  memoryPressure: MemoryPressure;
  rendererBackend: 'canvas2d' | 'webgpu' | 'webgl' | 'none' | 'unknown';
}

export interface CrashStackFrame {
  /** Sanitized module or component name. */
  module: string;
  /** Sanitized function name. */
  function?: string;
  line?: number;
  column?: number;
  /** Sanitized short file reference (basename + line), never a full path. */
  file?: string;
}

export interface CrashBreadcrumb {
  ts: number;
  event: string;
  category?: string;
}

export type CrashAttachmentKind =
  | 'log'
  | 'diagnostics-bundle'
  | 'screenshot'
  | 'example-file'
  | 'config';

export interface CrashAttachment {
  kind: CrashAttachmentKind;
  name: string;
  mime?: string;
  sizeBytes: number;
  /** Present locally for review; stripped from the upload payload. */
  content?: string;
  /** Attachments are never included unless the user explicitly includes them. */
  included: boolean;
}

export interface CrashReport {
  schemaVersion: typeof CRASH_REPORT_SCHEMA_VERSION;
  reportId: string;
  /** Non-persistent per-session identifier for deduplication. */
  sessionId: string;
  createdAt: number;
  release: CrashReleaseMetadata;
  runtime: CrashRuntimeMetadata;
  crash: CrashMetadata;
  breadcrumbs: CrashBreadcrumb[];
  attachments: CrashAttachment[];
  userComment?: string;
  /** Optional user-provided contact. Never auto-collected. */
  userContact?: string;
  consentPolicyVersion: number;
  recoveryStatus: RecoveryStatus;
  /** Local queue bookkeeping — stripped before upload. */
  uploadAttempts: number;
  uploadedAt?: number;
  /** Technical grouping fingerprint, computed locally. */
  groupFingerprint?: string;
}

export interface CrashMetadata {
  type: CrashType;
  /** Normalized category from the crash taxonomy (see docs/crash-reporting/taxonomy.md). */
  category: string;
  subsystem?: string;
  message: string;
  stack: CrashStackFrame[];
  /** Redacted raw trace for the expandable technical view. */
  rawStack?: string;
  threadCategory: CrashThreadCategory;
  reason?: string;
}

/** Size and count bounds (bounded payloads protect queue and backend). */
export const LIMITS = {
  maxStackFrames: 32,
  maxBreadcrumbs: 32,
  maxCrumbLength: 120,
  maxMessageLength: 500,
  maxRawStackLength: 8000,
  maxSubsystemLength: 80,
  maxCategoryLength: 80,
  maxCommentLength: 2000,
  maxContactLength: 200,
  maxAttachmentNameLength: 120,
  maxReportBytes: 256 * 1024,
  maxAttachmentBytes: 5 * 1024 * 1024,
  maxQueuedReports: 10,
  maxQueueBytes: 25 * 1024 * 1024,
  reportExpiryMs: 30 * 24 * 60 * 60 * 1000,
  maxUploadAttempts: 5,
} as const;

/**
 * Typed breadcrumb event namespaces. A crumb whose event does not match
 * `dotted.category` syntax and does not start with one of these namespaces is
 * dropped by the sanitizer — user content can never enter a breadcrumb
 * structurally. New namespaces require a privacy review (Phase 20 rule).
 */
export const KNOWN_CRUMB_PREFIXES = [
  'document.',
  'renderer.',
  'worker.',
  'export.',
  'import.',
  'autosave.',
  'backup.',
  'webgpu.',
  'webgl.',
  'canvas.',
  'workspace.',
  'command.',
  'model.',
  'font.',
  'print.',
  'persistence.',
  'startup.',
  'recovery.',
  'safe.',
  'consent.',
  'crash.',
  'hydration.',
  'window.',
  'collab.',
] as const;

export const CRUMB_EVENT_PATTERN = /^[a-z0-9]+(\.[a-z0-9]+){1,5}$/;

/** True when an event may be recorded as a diagnostic breadcrumb. */
export function isKnownCrumbEvent(event: string): boolean {
  if (!CRUMB_EVENT_PATTERN.test(event)) return false;
  return KNOWN_CRUMB_PREFIXES.some((prefix) => event.startsWith(prefix));
}

/** Every field's privacy classification. */
export const FIELD_CLASSIFICATION: Record<string, CrashReportFieldClass> = {
  schemaVersion: 'required-minimized',
  reportId: 'required-minimized',
  sessionId: 'required-minimized',
  createdAt: 'required-minimized',
  consentPolicyVersion: 'required-minimized',
  recoveryStatus: 'required-minimized',
  'release.appVersion': 'required-minimized',
  'release.buildChannel': 'required-minimized',
  'release.releaseId': 'required-minimized',
  'release.documentSchemaVersion': 'required-minimized',
  'release.tauriVersion': 'required-minimized',
  'release.frontendBundleVersion': 'optional',
  'release.gitCommit': 'optional',
  'runtime.runtime': 'required-minimized',
  'runtime.osFamily': 'required-minimized',
  'runtime.osVersionRange': 'required-minimized',
  'runtime.arch': 'required-minimized',
  'runtime.memoryPressure': 'required-minimized',
  'runtime.rendererBackend': 'required-minimized',
  'crash.type': 'required-minimized',
  'crash.category': 'required-minimized',
  'crash.threadCategory': 'required-minimized',
  'crash.subsystem': 'optional',
  'crash.message': 'required-minimized',
  'crash.stack': 'required-minimized',
  'crash.rawStack': 'optional',
  'crash.reason': 'optional',
  breadcrumbs: 'optional',
  attachments: 'attachment',
  userComment: 'attachment',
  userContact: 'attachment',
  groupFingerprint: 'required-minimized',
  uploadAttempts: 'local-only',
  uploadedAt: 'local-only',
};

export interface ValidationIssue {
  path: string;
  code:
    | 'unknown-field'
    | 'missing-required'
    | 'type-error'
    | 'out-of-bounds'
    | 'malformed'
    | 'prohibited';
  message: string;
}

/** Fields that may exist in a report payload. Everything else is rejected. */
const ALLOWED_TOP_LEVEL = new Set([
  'schemaVersion',
  'reportId',
  'sessionId',
  'createdAt',
  'release',
  'runtime',
  'crash',
  'breadcrumbs',
  'attachments',
  'userComment',
  'userContact',
  'consentPolicyVersion',
  'recoveryStatus',
  'uploadAttempts',
  'uploadedAt',
  'groupFingerprint',
]);

const ALLOWED_RELEASE = new Set([
  'appVersion',
  'buildChannel',
  'releaseId',
  'gitCommit',
  'tauriVersion',
  'frontendBundleVersion',
  'documentSchemaVersion',
]);

const ALLOWED_RUNTIME = new Set([
  'runtime',
  'osFamily',
  'osVersionRange',
  'arch',
  'memoryPressure',
  'rendererBackend',
]);

const ALLOWED_CRASH = new Set([
  'type',
  'category',
  'subsystem',
  'message',
  'stack',
  'rawStack',
  'threadCategory',
  'reason',
]);

const ALLOWED_FRAME = new Set(['module', 'function', 'line', 'column', 'file']);
const ALLOWED_CRUMB = new Set(['ts', 'event', 'category']);
const ALLOWED_ATTACHMENT = new Set(['kind', 'name', 'mime', 'sizeBytes', 'content', 'included']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function checkKeys(
  value: unknown,
  allowed: Set<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'unknown-field', message: `unknown field` });
    }
  }
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validates a crash report against the versioned schema. Rejects unknown
 * fields at the reporting boundary, enforces required fields, types, and
 * size/count bounds. This is the client-side gate; the ingestion validator
 * (`validateReportForIngestion`) mirrors it server-side.
 */
export function validateCrashReport(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return [{ path: '$', code: 'malformed', message: 'report is not an object' }];
  }
  checkKeys(value, ALLOWED_TOP_LEVEL, '$', issues);

  if (value.schemaVersion !== CRASH_REPORT_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      code: 'type-error',
      message: `unsupported schema version ${String(value.schemaVersion)}`,
    });
  }
  if (
    typeof value.reportId !== 'string' ||
    value.reportId.length === 0 ||
    value.reportId.length > 64
  ) {
    issues.push({ path: 'reportId', code: 'type-error', message: 'invalid reportId' });
  }
  if (
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    value.sessionId.length > 64
  ) {
    issues.push({ path: 'sessionId', code: 'type-error', message: 'invalid sessionId' });
  }
  if (!isNumber(value.createdAt)) {
    issues.push({ path: 'createdAt', code: 'type-error', message: 'missing createdAt' });
  }

  const release = value.release;
  if (!isPlainObject(release)) {
    issues.push({ path: 'release', code: 'missing-required', message: 'missing release metadata' });
  } else {
    checkKeys(release, ALLOWED_RELEASE, 'release', issues);
    if (typeof release.appVersion !== 'string' || release.appVersion.length === 0) {
      issues.push({
        path: 'release.appVersion',
        code: 'missing-required',
        message: 'missing appVersion',
      });
    }
    if (
      release.buildChannel !== 'dev' &&
      release.buildChannel !== 'nightly' &&
      release.buildChannel !== 'beta' &&
      release.buildChannel !== 'production'
    ) {
      issues.push({
        path: 'release.buildChannel',
        code: 'type-error',
        message: 'invalid buildChannel',
      });
    }
    if (typeof release.releaseId !== 'string' || release.releaseId.length === 0) {
      issues.push({
        path: 'release.releaseId',
        code: 'missing-required',
        message: 'missing releaseId',
      });
    }
    if (!isNumber(release.documentSchemaVersion)) {
      issues.push({
        path: 'release.documentSchemaVersion',
        code: 'type-error',
        message: 'invalid documentSchemaVersion',
      });
    }
  }

  const runtime = value.runtime;
  if (!isPlainObject(runtime)) {
    issues.push({ path: 'runtime', code: 'missing-required', message: 'missing runtime metadata' });
  } else {
    checkKeys(runtime, ALLOWED_RUNTIME, 'runtime', issues);
    for (const key of [
      'runtime',
      'osFamily',
      'arch',
      'memoryPressure',
      'rendererBackend',
    ] as const) {
      if (typeof runtime[key] !== 'string' || runtime[key].length === 0) {
        issues.push({ path: `runtime.${key}`, code: 'type-error', message: `invalid ${key}` });
      }
    }
  }

  const crash = value.crash;
  if (!isPlainObject(crash)) {
    issues.push({ path: 'crash', code: 'missing-required', message: 'missing crash metadata' });
  } else {
    checkKeys(crash, ALLOWED_CRASH, 'crash', issues);
    if (typeof crash.type !== 'string') {
      issues.push({ path: 'crash.type', code: 'type-error', message: 'invalid crash type' });
    }
    if (typeof crash.category !== 'string' || crash.category.length === 0) {
      issues.push({
        path: 'crash.category',
        code: 'missing-required',
        message: 'missing crash category',
      });
    }
    const message = crash.message;
    if (typeof message !== 'string' || message.length === 0) {
      issues.push({
        path: 'crash.message',
        code: 'missing-required',
        message: 'missing crash message',
      });
    } else if (message.length > LIMITS.maxMessageLength) {
      issues.push({
        path: 'crash.message',
        code: 'out-of-bounds',
        message: `message exceeds ${LIMITS.maxMessageLength} chars`,
      });
    }
    const rawStack = crash.rawStack;
    if (typeof rawStack === 'string' && rawStack.length > LIMITS.maxRawStackLength) {
      issues.push({ path: 'crash.rawStack', code: 'out-of-bounds', message: 'rawStack too long' });
    } else if (rawStack !== undefined && typeof rawStack !== 'string') {
      issues.push({ path: 'crash.rawStack', code: 'type-error', message: 'invalid rawStack' });
    }
    if (Array.isArray(crash.stack)) {
      if (crash.stack.length > LIMITS.maxStackFrames) {
        issues.push({ path: 'crash.stack', code: 'out-of-bounds', message: 'too many frames' });
      }
      for (let i = 0; i < crash.stack.length; i++) {
        const frame = crash.stack[i];
        if (!isPlainObject(frame)) {
          issues.push({ path: `crash.stack[${i}]`, code: 'type-error', message: 'invalid frame' });
          continue;
        }
        checkKeys(frame, ALLOWED_FRAME, `crash.stack[${i}]`, issues);
        if (typeof frame.module !== 'string') {
          issues.push({
            path: `crash.stack[${i}].module`,
            code: 'type-error',
            message: 'invalid module',
          });
        }
      }
    } else if (crash.stack !== undefined) {
      issues.push({ path: 'crash.stack', code: 'type-error', message: 'stack must be an array' });
    }
  }

  if (!Array.isArray(value.breadcrumbs)) {
    issues.push({
      path: 'breadcrumbs',
      code: 'type-error',
      message: 'breadcrumbs must be an array',
    });
  } else {
    if (value.breadcrumbs.length > LIMITS.maxBreadcrumbs) {
      issues.push({ path: 'breadcrumbs', code: 'out-of-bounds', message: 'too many breadcrumbs' });
    }
    for (let i = 0; i < value.breadcrumbs.length; i++) {
      const crumb = value.breadcrumbs[i];
      if (!isPlainObject(crumb)) {
        issues.push({ path: `breadcrumbs[${i}]`, code: 'type-error', message: 'invalid crumb' });
        continue;
      }
      checkKeys(crumb, ALLOWED_CRUMB, `breadcrumbs[${i}]`, issues);
      if (
        typeof crumb.event !== 'string' ||
        crumb.event.length === 0 ||
        crumb.event.length > LIMITS.maxCrumbLength
      ) {
        issues.push({
          path: `breadcrumbs[${i}].event`,
          code: 'type-error',
          message: 'invalid crumb event',
        });
      }
    }
  }

  if (!Array.isArray(value.attachments)) {
    issues.push({
      path: 'attachments',
      code: 'type-error',
      message: 'attachments must be an array',
    });
  } else {
    for (let i = 0; i < value.attachments.length; i++) {
      const attachment = value.attachments[i];
      if (!isPlainObject(attachment)) {
        issues.push({
          path: `attachments[${i}]`,
          code: 'type-error',
          message: 'invalid attachment',
        });
        continue;
      }
      checkKeys(attachment, ALLOWED_ATTACHMENT, `attachments[${i}]`, issues);
      if (typeof attachment.kind !== 'string') {
        issues.push({
          path: `attachments[${i}].kind`,
          code: 'type-error',
          message: 'invalid kind',
        });
      }
      if (
        typeof attachment.name !== 'string' ||
        attachment.name.length > LIMITS.maxAttachmentNameLength
      ) {
        issues.push({
          path: `attachments[${i}].name`,
          code: 'type-error',
          message: 'invalid name',
        });
      }
      if (attachment.content !== undefined && typeof attachment.content !== 'string') {
        issues.push({
          path: `attachments[${i}].content`,
          code: 'type-error',
          message: 'invalid content',
        });
      }
      if (attachment.sizeBytes !== undefined && !isNumber(attachment.sizeBytes)) {
        issues.push({
          path: `attachments[${i}].sizeBytes`,
          code: 'type-error',
          message: 'invalid sizeBytes',
        });
      }
      if (typeof attachment.included !== 'boolean') {
        issues.push({
          path: `attachments[${i}].included`,
          code: 'type-error',
          message: 'included must be boolean',
        });
      }
    }
  }

  const userComment = value.userComment;
  if (userComment !== undefined && typeof userComment !== 'string') {
    issues.push({ path: 'userComment', code: 'type-error', message: 'invalid userComment' });
  } else if (typeof userComment === 'string' && userComment.length > LIMITS.maxCommentLength) {
    issues.push({ path: 'userComment', code: 'out-of-bounds', message: 'comment too long' });
  }
  const userContact = value.userContact;
  if (userContact !== undefined && typeof userContact !== 'string') {
    issues.push({ path: 'userContact', code: 'type-error', message: 'invalid userContact' });
  } else if (typeof userContact === 'string' && userContact.length > LIMITS.maxContactLength) {
    issues.push({ path: 'userContact', code: 'out-of-bounds', message: 'contact too long' });
  }

  return issues;
}

/** True when the payload may be queued or transmitted. */
export function isValidCrashReport(value: unknown): value is CrashReport {
  return validateCrashReport(value).length === 0;
}

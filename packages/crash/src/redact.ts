/**
 * Centralized redaction and sanitization pipeline.
 *
 * Runs before a report is written to the local upload queue, not only before
 * network transmission — queued reports are therefore already safe to show
 * in review and safe to hold on disk.
 *
 * Strategy: structured allowlist extraction, not blacklist removal. A report
 * is rebuilt field-by-field from a fixed schema; anything not in the schema
 * is dropped. Every free-text value passes through `redactText`, which
 * normalizes the prohibited-data classes defined in schema.ts.
 *
 * Redaction is best-effort normalization: it scrubs known patterns (paths,
 * URLs, emails, IPs, tokens, secrets) but technical information can still
 * sometimes be identifying. The UI says so honestly.
 */

import {
  CRASH_REPORT_SCHEMA_VERSION,
  type CrashAttachment,
  type CrashBreadcrumb,
  type CrashReport,
  type CrashStackFrame,
  isKnownCrumbEvent,
  LIMITS,
} from './schema';

const HOME_DIR_RE = /(?:^|\/|\\)home\/[^/\\\s]+/gi;
const WINDOWS_USERS_RE = /([A-Za-z]:[\\/]Users[\\/])[^/\\\s]+/gi;
const WINDOWS_TEMP_RE = /[A-Za-z]:[\\/](?:Users[\\/][^/\\\s]+[\\/])?AppData[\\/]Local[\\/]Temp/gi;
const MACOS_TEMP_RE = /\/var\/folders\/[^\s"'<>]+/gi;
const POSIX_TMP_RE = /\/tmp(?:[\\/][^\s"'<>()]*)?/gi;
const ABSOLUTE_PATH_RE = /(?<![:\w])(?:[A-Za-z]:[\\/]|(?<![:/])[\\/])[^\s"'<>]{6,}/gi;
const NETWORK_SHARE_RE = /\\\\[^\\\s]+\\[^\\\s]+/gi;
const URL_RE = /https?:\/\/[^\s"'<>()]+/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
// Compressed IPv6 (fd00::a1b2:...), loopback (::1), and full 8-group forms.
// Deliberately does not match plain hh:mm:ss timestamps.
const IPV6_RE =
  /\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4})*::[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{1,4})*\b|\b::[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g;
// Code files retain their basename for triage; design documents and other
// user-named files collapse entirely (their names are prohibited data).
const CODE_FILE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|rs|wasm|html|css|scss|json|py|go|swift|kt|dart)$/i;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi;
const KEY_VALUE_SECRET_RE =
  /((?:api[_-]?key|secret|token|password|passwd|authorization)\s*[=:]\s*)[^\s&;"']+/gi;
const AWS_CRED_RE = /((?:AKIA|ASIA)[A-Z0-9]{16})/g;
// AWS secret access keys are exactly 40 base64 characters.
const AWS_SECRET_RE = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/])/g;
const LONG_B64_RE = /[A-Za-z0-9+/]{48,}={0,2}/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Replaces a match while preserving a leading prefix if provided. */
function keepPrefix(prefix: string | undefined): string {
  return prefix ? `${prefix}<redacted>` : '<redacted>';
}

/** Replaces every prohibited pattern in a free-text value. */
export function redactText(input: string): string {
  let out = input;
  // Home directories: /home/<user>/... → ~/<redacted>/... (username removed)
  out = out.replace(HOME_DIR_RE, '~');
  // Windows users: C:\Users\Bob\... → C:\Users\<redacted>\...
  out = out.replace(WINDOWS_USERS_RE, (_match, prefix: string) => `${prefix}<user>`);
  // Temp directories → <tmp>
  out = out.replace(WINDOWS_TEMP_RE, '<tmp>');
  out = out.replace(MACOS_TEMP_RE, '<tmp>');
  out = out.replace(POSIX_TMP_RE, '<tmp>/');
  // Network shares → <share>
  out = out.replace(NETWORK_SHARE_RE, '<share>');
  // URLs: strip userinfo, query, and fragment; keep scheme + host only.
  // Runs before token rules so URL-embedded secrets are consumed whole.
  out = out.replace(URL_RE, (url) => {
    const scheme = url.match(/^https?:\/\//i)?.[0] ?? '';
    const rest = url.slice(scheme.length);
    const withoutUserInfo = rest.replace(/^[^/@]+@/, '');
    const host = withoutUserInfo.split(/[/?#]/)[0] ?? '';
    return `${scheme}${host}/<redacted>`;
  });
  // Emails → <email>
  out = out.replace(EMAIL_RE, '<email>');
  // IPs → <ip>
  out = out.replace(IPV4_RE, '<ip>');
  out = out.replace(IPV6_RE, '<ip>');
  // Bearer tokens
  out = out.replace(BEARER_RE, (_m, prefix: string) => keepPrefix(prefix));
  // key=value secrets
  out = out.replace(KEY_VALUE_SECRET_RE, (_m, prefix: string) => keepPrefix(prefix));
  // AWS access key ids
  out = out.replace(AWS_CRED_RE, '<aws-key>');
  // AWS secret access keys (exactly 40 base64 chars)
  out = out.replace(AWS_SECRET_RE, '<aws-secret>');
  // Long base64-ish runs (JWTs, refresh tokens, model tokens)
  out = out.replace(LONG_B64_RE, '<token>');
  // UUIDs (document/file/object identifiers) → <id>
  out = out.replace(UUID_RE, '<id>');
  // Generic absolute paths → keep the basename only when it is a code file
  // (triage value without filesystem layout). Runs last so it cannot re-eat
  // URL hosts or the placeholders above.
  out = out.replace(ABSOLUTE_PATH_RE, (match) => {
    const segments = match.split(/[\\/]/);
    const basename = segments.at(-1);
    if (!basename || basename.length === 0) return '<path>';
    const stem = basename.split(':')[0] ?? basename;
    if (!CODE_FILE_RE.test(stem)) return '<path>';
    return `\u2026/${basename}`;
  });
  return out;
}

/** Truncates a string safely at a code-point boundary. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return Array.from(text).slice(0, max).join('');
}

/** Sanitizes a stack-trace line without losing the frame structure. */
export function sanitizeStackLine(line: string): string {
  return truncate(redactText(line).replace(/\s+/g, ' ').trim(), LIMITS.maxMessageLength);
}

/** Parses one browser-style stack frame line into structured frame data. */
export function parseStackFrame(line: string, _index: number): CrashStackFrame | null {
  const cleaned = sanitizeStackLine(line);
  if (cleaned.length === 0) return null;
  const at = /(?:\s+at\s+|\bat\s+)?(.+)/.exec(cleaned)?.[1] ?? cleaned;
  // "name (http://host/path.js:12:34)" or "http://host/path.js:12:34"
  const paren = /^(.+)\s+\((.+)\)$/.exec(at);
  const source = paren?.[2] ?? at;
  const func = paren?.[1];
  const loc = /^(.*):(\d+):(\d+)$/.exec(source);
  const file = loc?.[1] ?? source;
  // Keep only the basename — never a full path or URL.
  const basename = file.split('/').pop() ?? file;
  if (basename.length === 0) return null;
  const module = /^https?:\/\//i.test(basename)
    ? '<url>'
    : truncate(redactText(basename.split(':')[0] ?? basename), 100);
  if (module.length === 0) return null;
  return {
    module,
    function: func ? truncate(redactText(func), 120) : undefined,
    line: loc ? Number(loc[2]) : undefined,
    column: loc ? Number(loc[3]) : undefined,
    // File references are dropped for URL sources; hosts are not collected.
    file: /^https?:\/\//i.test(file) ? undefined : truncate(basename, 160),
  };
}

/** Bounds a raw stack string into a frame list (max LIMITS.maxStackFrames). */
export function parseStack(rawStack: string): CrashStackFrame[] {
  const frames: CrashStackFrame[] = [];
  for (const rawLine of rawStack.split('\n')) {
    if (frames.length >= LIMITS.maxStackFrames) break;
    const frame = parseStackFrame(rawLine, frames.length);
    if (frame) frames.push(frame);
  }
  return frames;
}

export interface SanitizeOptions {
  /** Keep optional fields (extended diagnostics opt-in). Default false. */
  includeOptional?: boolean;
  /** Keep attachment content payloads for local review. Default true. */
  includeAttachmentContent?: boolean;
}

/** Prototype-pollution-safe accessor: only plain own enumerable keys. */
function own(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {};
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = (value as Record<string, unknown>)[key];
  }
  return out;
}

function redactString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const redacted = redactText(value);
  if (redacted.length === 0) return undefined;
  return truncate(redacted, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Rebuilds a crash report from untrusted input using a strict allowlist.
 * Unknown fields are dropped, every string is redacted and bounded, arrays
 * are capped. Output always validates against the schema. Payloads with a
 * non-plain prototype (prototype-pollution attempts) are rejected outright.
 */
export function sanitizeCrashReport(
  input: unknown,
  options: SanitizeOptions = {},
): CrashReport | null {
  if (!isPlainRecord(input)) return null;
  const top = own(input);

  const releaseRaw = own(top.release);
  const runtimeRaw = own(top.runtime);
  const crashRaw = own(top.crash);

  const stackRaw = Array.isArray(crashRaw.stack)
    ? crashRaw.stack.slice(0, LIMITS.maxStackFrames)
    : [];
  const stack: CrashStackFrame[] = [];
  for (const frameRaw of stackRaw) {
    if (!isRecord(frameRaw)) continue;
    const f = own(frameRaw);
    const module = redactString(f.module ?? '', 100);
    if (!module) continue;
    stack.push({
      module,
      function: redactString(f.function, 120),
      line: typeof f.line === 'number' ? f.line : undefined,
      column: typeof f.column === 'number' ? f.column : undefined,
      file: redactString(f.file, 160),
    });
  }

  const crumbsRaw = Array.isArray(top.breadcrumbs)
    ? top.breadcrumbs.slice(0, LIMITS.maxBreadcrumbs)
    : [];
  const breadcrumbs: CrashBreadcrumb[] = [];
  for (const crumbRaw of crumbsRaw) {
    if (!isRecord(crumbRaw)) continue;
    const c = own(crumbRaw);
    const event = redactString(c.event, LIMITS.maxCrumbLength);
    if (!event) continue;
    // Typed-event gate: events outside the known namespaces are dropped, so
    // user content cannot enter breadcrumbs structurally.
    if (!isKnownCrumbEvent(event)) continue;
    breadcrumbs.push({
      ts: typeof c.ts === 'number' ? c.ts : Date.now(),
      event,
      category: redactString(c.category, 40),
    });
  }

  const attachmentsRaw = Array.isArray(top.attachments) ? top.attachments : [];
  const attachments: CrashAttachment[] = [];
  for (const aRaw of attachmentsRaw) {
    if (!isRecord(aRaw)) continue;
    const a = own(aRaw);
    const name = redactString(a.name, LIMITS.maxAttachmentNameLength);
    if (!name) continue;
    const kind = a.kind;
    if (
      kind !== 'log' &&
      kind !== 'diagnostics-bundle' &&
      kind !== 'screenshot' &&
      kind !== 'example-file' &&
      kind !== 'config'
    ) {
      continue;
    }
    const content = a.content;
    let contentOut: string | undefined;
    if (typeof content === 'string' && content.length > 0) {
      if (options.includeAttachmentContent === false) {
        contentOut = undefined;
      } else if (kind === 'log' || kind === 'config' || kind === 'diagnostics-bundle') {
        // Text attachments are redacted before they are stored locally.
        contentOut = redactText(truncate(content, LIMITS.maxAttachmentBytes));
      } else {
        // Binary attachments (screenshot, example file) are user-selected and
        // kept verbatim for review; they never leave the device unless the
        // user explicitly includes them and the uploader strips them again.
        contentOut = truncate(content, LIMITS.maxAttachmentBytes);
      }
    }
    attachments.push({
      kind,
      name,
      mime: redactString(a.mime, 80),
      sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : 0,
      content: contentOut,
      included: a.included === true,
    });
  }

  const includeOptional = options.includeOptional === true;

  const report: CrashReport = {
    schemaVersion: CRASH_REPORT_SCHEMA_VERSION,
    reportId:
      typeof top.reportId === 'string' && top.reportId.length > 0 && top.reportId.length <= 64
        ? top.reportId
        : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    sessionId:
      typeof top.sessionId === 'string' && top.sessionId.length > 0 && top.sessionId.length <= 64
        ? top.sessionId
        : 'unknown',
    createdAt: typeof top.createdAt === 'number' ? top.createdAt : Date.now(),
    release: {
      appVersion: redactString(releaseRaw.appVersion ?? '', 40) ?? 'unknown',
      buildChannel:
        releaseRaw.buildChannel === 'dev' ||
        releaseRaw.buildChannel === 'nightly' ||
        releaseRaw.buildChannel === 'beta' ||
        releaseRaw.buildChannel === 'production'
          ? releaseRaw.buildChannel
          : 'dev',
      releaseId: redactString(releaseRaw.releaseId ?? '', 80) ?? 'unknown',
      documentSchemaVersion:
        typeof releaseRaw.documentSchemaVersion === 'number' ? releaseRaw.documentSchemaVersion : 0,
      tauriVersion: includeOptional ? redactString(releaseRaw.tauriVersion, 40) : undefined,
      frontendBundleVersion: includeOptional
        ? redactString(releaseRaw.frontendBundleVersion, 40)
        : undefined,
      gitCommit: includeOptional ? redactString(releaseRaw.gitCommit, 40) : undefined,
    },
    runtime: {
      runtime:
        runtimeRaw.runtime === 'tauri' ||
        runtimeRaw.runtime === 'browser' ||
        runtimeRaw.runtime === 'webview2' ||
        runtimeRaw.runtime === 'webkitgtk' ||
        runtimeRaw.runtime === 'wkwebview'
          ? runtimeRaw.runtime
          : 'browser',
      osFamily:
        runtimeRaw.osFamily === 'windows' ||
        runtimeRaw.osFamily === 'macos' ||
        runtimeRaw.osFamily === 'linux' ||
        runtimeRaw.osFamily === 'android' ||
        runtimeRaw.osFamily === 'ios'
          ? runtimeRaw.osFamily
          : 'unknown',
      osVersionRange: redactString(runtimeRaw.osVersionRange, 24),
      arch:
        runtimeRaw.arch === 'x64' ||
        runtimeRaw.arch === 'arm64' ||
        runtimeRaw.arch === 'ia32' ||
        runtimeRaw.arch === 'wasm32'
          ? runtimeRaw.arch
          : 'unknown',
      memoryPressure:
        runtimeRaw.memoryPressure === 'low' ||
        runtimeRaw.memoryPressure === 'medium' ||
        runtimeRaw.memoryPressure === 'high' ||
        runtimeRaw.memoryPressure === 'critical'
          ? runtimeRaw.memoryPressure
          : 'unknown',
      rendererBackend:
        runtimeRaw.rendererBackend === 'canvas2d' ||
        runtimeRaw.rendererBackend === 'webgpu' ||
        runtimeRaw.rendererBackend === 'webgl'
          ? runtimeRaw.rendererBackend
          : 'unknown',
    },
    crash: {
      type:
        crashRaw.type === 'error' ||
        crashRaw.type === 'unhandledrejection' ||
        crashRaw.type === 'react' ||
        crashRaw.type === 'worker' ||
        crashRaw.type === 'wasm' ||
        crashRaw.type === 'rust-panic' ||
        crashRaw.type === 'contextlost' ||
        crashRaw.type === 'oom' ||
        crashRaw.type === 'hang' ||
        crashRaw.type === 'fatal' ||
        crashRaw.type === 'unknown'
          ? crashRaw.type
          : 'unknown',
      category: redactString(crashRaw.category, LIMITS.maxCategoryLength) ?? 'unknown',
      subsystem: includeOptional
        ? redactString(crashRaw.subsystem, LIMITS.maxSubsystemLength)
        : undefined,
      message: redactString(crashRaw.message, LIMITS.maxMessageLength) ?? 'unknown',
      stack,
      rawStack: includeOptional
        ? redactString(crashRaw.rawStack, LIMITS.maxRawStackLength)
        : undefined,
      threadCategory:
        crashRaw.threadCategory === 'main' ||
        crashRaw.threadCategory === 'worker' ||
        crashRaw.threadCategory === 'render' ||
        crashRaw.threadCategory === 'native' ||
        crashRaw.threadCategory === 'wasm'
          ? crashRaw.threadCategory
          : 'unknown',
      reason: includeOptional ? redactString(crashRaw.reason, 200) : undefined,
    },
    breadcrumbs,
    attachments,
    userComment: redactString(top.userComment, LIMITS.maxCommentLength),
    userContact: redactString(top.userContact, LIMITS.maxContactLength),
    consentPolicyVersion:
      typeof top.consentPolicyVersion === 'number' ? top.consentPolicyVersion : 0,
    recoveryStatus:
      top.recoveryStatus === 'recovered' ||
      top.recoveryStatus === 'not-recovered' ||
      top.recoveryStatus === 'not-applicable'
        ? top.recoveryStatus
        : 'not-applicable',
    uploadAttempts: 0,
    groupFingerprint: redactString(top.groupFingerprint, 80),
  };

  return report;
}

/**
 * Strips local-only bookkeeping and attachment content from a report before
 * transmission. The resulting payload contains only schema fields.
 */
export function toUploadPayload(report: CrashReport): string {
  const { uploadAttempts: _uploadAttempts, uploadedAt: _uploadedAt, ...payload } = report;
  payload.attachments = report.attachments
    .filter((a) => a.included)
    .map((a) => ({ ...a, content: undefined }));
  return JSON.stringify(payload);
}

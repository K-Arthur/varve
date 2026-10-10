/**
 * Diagnostics that are not application failures.
 *
 * Window `error` / `unhandledrejection` handlers used to treat every one of
 * these as a crash and open the recovery dialog while the document was still
 * healthy. ResizeObserver loop notices, aborted work, recovered GPU loss, and
 * teardown IPC are expected on WebKitGTK, WebView2, and the browser build.
 */

export interface DiagnosticParts {
  name: string;
  message: string;
  code?: number | string;
}

const RESIZE_OBSERVER_LOOP =
  /resizeobserver loop (completed with undelivered notifications|limit exceeded)/i;

const ABORT_MESSAGE =
  /^(the operation was aborted|the user aborted a request|signal is aborted(?: without reason)?|aborted|cancell?ed|the play\(\) request was interrupted|export cancelled|presentation capture cancelled|hdr operation cancelled)\.?$/i;

const GPU_LOSS =
  /webgl(?:2)? context lost|webgpu device(?: was)? lost|gpudevice(?: was)? lost|gpu(?:device)?lost|device (?:was )?lost|device lost/i;

const TEARDOWN_IPC =
  /webview (?:has been )?(?:dropped|destroyed)|webview not found|window not found|command (?:was )?cancell?ed|promise cancell?ed|the webview was (?:dropped|destroyed)/i;

const FONT_LOAD = /failed to (?:load|decode) font|ots parsing error|fontface(?:\.load)?/i;

export function diagnosticParts(value: unknown): DiagnosticParts {
  if (value == null) return { name: '', message: '' };
  if (typeof value === 'string') return { name: '', message: value };
  if (value instanceof Error) {
    const code = 'code' in value ? (value as { code?: number | string }).code : undefined;
    return {
      name: value.name,
      message: value.message,
      ...(code === undefined ? {} : { code }),
    };
  }
  if (typeof value === 'object') {
    const obj = value as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      reason?: unknown;
    };
    const message =
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.reason === 'string'
          ? obj.reason
          : '';
    const name = typeof obj.name === 'string' ? obj.name : '';
    const code =
      typeof obj.code === 'number' || typeof obj.code === 'string' ? obj.code : undefined;
    return { name, message, ...(code === undefined ? {} : { code }) };
  }
  return { name: '', message: String(value) };
}

function isAbortLike(parts: DiagnosticParts): boolean {
  if (parts.name === 'AbortError') return true;
  if (parts.code === 20 || parts.code === 'ABORT_ERR') return true;
  return ABORT_MESSAGE.test(parts.message.trim());
}

function isRecoveredGpuLoss(parts: DiagnosticParts): boolean {
  if (parts.name === 'GPUDeviceLostError' || parts.name === 'WebGLContextEvent') return true;
  return GPU_LOSS.test(parts.message);
}

function isTeardownIpc(parts: DiagnosticParts): boolean {
  return TEARDOWN_IPC.test(parts.message);
}

function isFontLoadFailure(parts: DiagnosticParts): boolean {
  if (parts.name === 'NetworkError' && /font/i.test(parts.message)) return true;
  return FONT_LOAD.test(parts.message);
}

/** True when a thrown/rejected value is a recovered or cancelled diagnostic. */
export function isBenignDiagnostic(value: unknown): boolean {
  const parts = diagnosticParts(value);
  if (!parts.name && !parts.message) return false;
  if (isAbortLike(parts)) return true;
  if (RESIZE_OBSERVER_LOOP.test(parts.message)) return true;
  if (isRecoveredGpuLoss(parts)) return true;
  if (isTeardownIpc(parts)) return true;
  if (isFontLoadFailure(parts)) return true;
  return false;
}

/** Window `error` events that must not open the crash UI. */
export function isBenignWindowErrorEvent(event: Event): boolean {
  if (event.type === 'webglcontextlost' || event.type === 'contextlost') return true;
  if (event instanceof ErrorEvent) {
    if (isBenignDiagnostic(event.error)) return true;
    if (typeof event.message === 'string' && isBenignDiagnostic(event.message)) return true;
  }
  return false;
}

/** Unhandled rejections that must not open the crash UI. */
export function isBenignRejection(reason: unknown): boolean {
  return isBenignDiagnostic(reason);
}

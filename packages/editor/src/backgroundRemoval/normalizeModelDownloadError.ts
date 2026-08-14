/**
 * normalizeModelDownloadError — categorize every rejection shape the model
 * download path can produce into a stable, user-presentable form.
 *
 * The download boundary rejects with wildly different shapes:
 *   - `Error` instances (fetch, checksum, storage)
 *   - plain strings (Tauri `Err(String)` from Rust commands — the invoke
 *     promise rejects with the raw string, so `(e as Error).message` is
 *     `undefined` and the dialog rendered "Download failed: undefined")
 *   - Tauri IPC objects `{ code, message }` (serialized command errors)
 *   - DOMException (AbortError)
 *   - unknown/foreign objects
 *
 * The UI must never interpolate a raw message: a message is only ever shown
 * after this normalizer has classified it, and the classification decides
 * whether Retry can help.
 */

export type ModelDownloadErrorCategory =
  | 'cancelled'
  | 'network'
  | 'tls'
  | 'timeout'
  | 'http'
  | 'integrity'
  | 'storage'
  | 'permission'
  | 'native-unavailable'
  | 'unknown';

export interface NormalizedModelDownloadError {
  category: ModelDownloadErrorCategory;
  /** Short, human title for the error panel (never empty). */
  userMessage: string;
  /** Longer actionable detail (never empty when known). */
  detail: string;
  /** Whether pressing Retry has a reasonable chance of success. */
  retryable: boolean;
  /** Raw technical message, for the developer-details section. */
  technicalMessage: string;
}

const UNKNOWN_USER_MESSAGE = "The download couldn't be completed for an unknown reason.";

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object') {
    const obj = value as { message?: unknown; code?: unknown; error?: unknown };
    if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message;
    if (typeof obj.error === 'string' && obj.error.length > 0) return obj.error;
  }
  return '';
}

function detailFor(category: ModelDownloadErrorCategory, technical: string): string {
  switch (category) {
    case 'network':
      return 'The app could not reach the model host. Check your connection and try again.';
    case 'tls':
      return 'The secure connection to the model host was refused or failed. This can happen behind strict networks or proxies.';
    case 'timeout':
      return 'The model host did not respond in time. The download will not cost anything extra to retry.';
    case 'http':
      return `The model host rejected the download (${technical}). The file may have been removed or the URL may be stale.`;
    case 'integrity':
      return 'Varve downloaded the file but it failed integrity verification. The model was not installed.';
    case 'storage':
      return 'There is not enough free storage on this device for the model. Free up space or remove old models first.';
    case 'permission':
      return 'This device refused permission to write the model file. Check the app data directory permissions.';
    case 'native-unavailable':
      return 'This desktop build cannot run the model downloader. Update Varve to a build that ships the AI runtime, or use the web version.';
    case 'cancelled':
      return 'The download was cancelled.';
    default:
      return UNKNOWN_USER_MESSAGE;
  }
}

function technicalFrom(value: unknown): string {
  const text = textOf(value).trim();
  if (text.length > 0) return text;
  try {
    const json = JSON.stringify(value);
    return json && json !== '{}' ? json.slice(0, 400) : 'No error details were provided.';
  } catch {
    return 'No error details were provided.';
  }
}

/**
 * Classify a rejection value. Order matters: cancellation first (the abort
 * path must never look like a failure), then the recognizable technical
 * patterns, then shape-based heuristics, then unknown.
 */
export function normalizeModelDownloadError(value: unknown): NormalizedModelDownloadError {
  const technical = technicalFrom(value);
  const text = technical.toLowerCase();
  const isError = value instanceof Error;

  if (value === null || value === undefined) {
    return {
      category: 'unknown',
      userMessage: UNKNOWN_USER_MESSAGE,
      detail: detailFor('unknown', technical),
      retryable: true,
      technicalMessage: technical,
    };
  }

  if (isError && value.name === 'AbortError') {
    return {
      category: 'cancelled',
      userMessage: 'The download was cancelled.',
      detail: detailFor('cancelled', technical),
      retryable: false,
      technicalMessage: technical,
    };
  }
  if (text.includes('cancelled') || text.includes('aborted')) {
    return {
      category: 'cancelled',
      userMessage: 'The download was cancelled.',
      detail: detailFor('cancelled', technical),
      retryable: false,
      technicalMessage: technical,
    };
  }

  if (
    text.includes('sha-256') ||
    text.includes('checksum') ||
    text.includes('size mismatch') ||
    text.includes('integrity') ||
    text.includes('failed verification') ||
    text.includes('has no sha-256')
  ) {
    return {
      category: 'integrity',
      userMessage: "Couldn't install the model",
      detail: detailFor('integrity', technical),
      retryable: false,
      technicalMessage: technical,
    };
  }

  if (
    text.includes('quota') ||
    text.includes('not enough storage') ||
    text.includes('no space left') ||
    text.includes('disk') ||
    text.includes('storage')
  ) {
    return {
      category: 'storage',
      userMessage: 'Not enough storage for the model',
      detail: detailFor('storage', technical),
      retryable: false,
      technicalMessage: technical,
    };
  }

  if (
    text.includes('permission denied') ||
    text.includes('permission') ||
    text.includes('access denied') ||
    text.includes('read-only') ||
    text.includes('failed to create model directory') ||
    text.includes('failed to create model file') ||
    text.includes('failed to write model file')
  ) {
    return {
      category: 'permission',
      userMessage: 'The app could not write the model file',
      detail: detailFor('permission', technical),
      retryable: false,
      technicalMessage: technical,
    };
  }

  if (text.includes('onnx runtime') || text.includes('onnxruntime')) {
    return {
      category: 'native-unavailable',
      userMessage: 'The AI runtime is not available in this build',
      detail: detailFor('native-unavailable', technical),
      retryable: false,
      technicalMessage: technical,
    };
  }

  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('network request failed')
  ) {
    return {
      category: 'timeout',
      userMessage: "The download didn't finish in time",
      detail: detailFor('timeout', technical),
      retryable: true,
      technicalMessage: technical,
    };
  }

  if (text.includes('tls') || text.includes('certificate') || text.includes('ssl')) {
    return {
      category: 'tls',
      userMessage: "Couldn't reach the model host securely",
      detail: detailFor('tls', technical),
      retryable: true,
      technicalMessage: technical,
    };
  }

  if (
    text.includes('network') ||
    text.includes('offline') ||
    text.includes('fetch') ||
    text.includes('http') ||
    text.includes('connect') ||
    text.includes('dns') ||
    text.includes('socket')
  ) {
    return {
      category: 'network',
      userMessage: "Couldn't download the model",
      detail: detailFor('network', technical),
      retryable: true,
      technicalMessage: technical,
    };
  }

  if (/^\s*\d{3}\s/.test(technical) || /failed with status/.test(text)) {
    return {
      category: 'http',
      userMessage: 'The model host rejected the download',
      detail: detailFor('http', technical),
      retryable: true,
      technicalMessage: technical,
    };
  }

  // Shape-based fallbacks: strings and Error-like values always get a
  // presentable message; truly foreign objects land on the generic copy.
  return {
    category: 'unknown',
    userMessage: UNKNOWN_USER_MESSAGE,
    detail: detailFor('unknown', technical),
    retryable: true,
    technicalMessage: technical,
  };
}

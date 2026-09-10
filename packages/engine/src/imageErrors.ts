/**
 * Typed image resource failures.
 *
 * Replaces the generic "image failed" state with a small, stable error
 * model so UI, export preflight, and worker admission can distinguish
 * missing files from corruption, CORS restrictions from permission
 * problems, and permanent failures from transient ones. Classification is
 * best-effort: an unclassifiable failure is `unknown`, never guessed.
 *
 * Codes (mission resource-error taxonomy, adapted to Varve's local-first
 * model):
 * - `missing`       — the resource no longer exists (HTTP 404/410)
 * - `corrupt`       — bytes present but the decoder rejected them
 * - `unsupported`   — format the runtime decoder cannot decode
 * - `permission`    — access denied (HTTP 401/403)
 * - `unavailable`   — transient network/transport failure (HTTP 5xx, offline)
 * - `cors`          — resource displays but taints the canvas (not
 *                     pixel-readable / not export-safe)
 * - `admission`     — memory-budget admission refused (worker path)
 * - `cancelled`     — superseded or cancelled before a terminal state
 * - `unknown`       — classification failed
 */

export type ImageErrorCode =
  | 'missing'
  | 'corrupt'
  | 'unsupported'
  | 'permission'
  | 'unavailable'
  | 'cors'
  | 'admission'
  | 'cancelled'
  | 'unknown';

export const IMAGE_ERROR_CODES: readonly ImageErrorCode[] = [
  'missing',
  'corrupt',
  'unsupported',
  'permission',
  'unavailable',
  'cors',
  'admission',
  'cancelled',
  'unknown',
];

export function isImageErrorCode(value: string): value is ImageErrorCode {
  return (IMAGE_ERROR_CODES as readonly string[]).includes(value);
}

export class ImageLoadError extends Error {
  readonly code: ImageErrorCode;
  /** HTTP status when the failure was classified over the network. */
  readonly httpStatus?: number;
  /** The identity that failed (source URL or resource handle). */
  readonly source: string;

  constructor(source: string, code: ImageErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'ImageLoadError';
    this.code = code;
    this.source = source;
    this.httpStatus = httpStatus;
  }
}

/** True when the code represents a terminal failure that retry cannot fix. */
export function isPermanentImageFailure(code: ImageErrorCode): boolean {
  return code === 'missing' || code === 'corrupt' || code === 'unsupported' || code === 'cors';
}

const INLINE_URL = /^(data:|blob:)/;

/**
 * Synchronous classification for inline sources: a data:/blob: source that
 * failed to decode is corrupt (or unsupported when the MIME is declared).
 */
export function classifyInlineImageFailure(source: string, _cause?: unknown): ImageLoadError {
  const mime = /^data:([^;,]+)/.exec(source)?.[1];
  const code: ImageErrorCode = mime && !mime.startsWith('image/') ? 'unsupported' : 'corrupt';
  return new ImageLoadError(
    source,
    code,
    `Image failed to decode (${code})${mime ? `: ${mime}` : ''}`,
  );
}

const CLASSIFICATION_TIMEOUT_MS = 4000;

/**
 * True when `source` resolves to an http(s) URL. The image element already
 * attempted this exact source, so re-probing it with `fetch` grants no new
 * request capability for that scheme — but `fetch` also honors schemes
 * (`file:`, app-custom protocols in a webview, ...) that `<img>` handles
 * differently, so the probe stays restricted to the schemes it's meant for.
 */
function isProbeableRemoteUrl(source: string): boolean {
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined;
    const protocol = new URL(source, base).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Bounded fetch probe that never hangs classification. */
async function probeFetch(source: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFICATION_TIMEOUT_MS);
  try {
    return await fetch(source, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classify a remote load failure by probing the server. Never throws:
 * every probe outcome maps to a code (`unknown` last resort). Bounded by an
 * abort timeout so a hung server cannot stall classification.
 */
export async function classifyRemoteImageFailure(
  source: string,
  _cause?: unknown,
): Promise<ImageLoadError> {
  if (INLINE_URL.test(source)) return classifyInlineImageFailure(source);
  if (!isProbeableRemoteUrl(source)) {
    return new ImageLoadError(source, 'unknown', 'Image source is not an http(s) URL');
  }

  try {
    const response = await probeFetch(source, { mode: 'cors' });
    const status = response.status;
    if (status === 401 || status === 403) {
      return new ImageLoadError(source, 'permission', `Access denied (HTTP ${status})`, status);
    }
    if (status === 404 || status === 410) {
      return new ImageLoadError(source, 'missing', `Resource not found (HTTP ${status})`, status);
    }
    if (status >= 500) {
      return new ImageLoadError(source, 'unavailable', `Server error (HTTP ${status})`, status);
    }
    if (status >= 200 && status < 300) {
      return new ImageLoadError(
        source,
        'corrupt',
        `Server returned HTTP ${status} but the image failed to decode`,
        status,
      );
    }
    return new ImageLoadError(source, 'unknown', `Unhandled HTTP status ${status}`, status);
  } catch {
    // The CORS probe failed. A no-cors probe that still succeeds means the
    // server exists but does not grant pixel access — the canonical
    // "displays but taints" state. A no-cors probe that also fails means the
    // server (or the network) is unreachable.
    try {
      const probe = await probeFetch(source, { mode: 'no-cors' });
      if (probe.type === 'opaque') {
        return new ImageLoadError(
          source,
          'cors',
          'Image loads but the server does not permit CORS pixel access; it taints exports',
        );
      }
      return new ImageLoadError(source, 'unknown', 'Unexpected no-cors probe result');
    } catch {
      return new ImageLoadError(
        source,
        'unavailable',
        'The image server is unreachable or the network request failed',
      );
    }
  }
}

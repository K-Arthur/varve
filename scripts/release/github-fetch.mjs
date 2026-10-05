/**
 * Small, bounded retry wrapper for GitHub API and release-asset GET requests.
 *
 * Transient transport failures and server errors retry with exponential
 * backoff. Client errors remain visible to the caller; in particular, rate
 * limits are not retried in a tight loop. Retry diagnostics redact URL
 * credentials, query parameters, and fragments because release asset URLs can
 * carry signed query strings.
 */

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 8_000;
const DEFAULT_MAX_RETRY_AFTER_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function redactRequestUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '<invalid URL>';
  }
}

function retryAfterMs(response, now = Date.now()) {
  const value = response.headers?.get?.('retry-after')?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.ceil(Number(value) * 1_000));
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function transientStatus(status) {
  return status === 408 || status === 425 || (status >= 500 && status <= 599);
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Request a GitHub URL with bounded retries for transient failures only.
 * Returns the final non-success HTTP response so existing callers can keep
 * applying their endpoint-specific fail-closed rules.
 */
export async function fetchGitHubWithRetry(
  requestUrl,
  {
    headers,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    onRetry = (event) => {
      process.stderr.write(
        `transient GitHub ${event.kind} for ${event.url}; retry ${event.attempt + 1}/${event.maxAttempts} in ${event.delayMs}ms\n`,
      );
    },
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    maxRetryAfterMs = DEFAULT_MAX_RETRY_AFTER_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {},
) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is not available');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer');
  }

  const safeUrl = redactRequestUrl(requestUrl);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(requestUrl, {
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      if (attempt + 1 >= maxAttempts) {
        throw new Error(
          `GitHub request failed after ${maxAttempts} attempts for ${safeUrl} (${error?.name ?? 'network error'})`,
        );
      }
      const delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      await onRetry({ attempt, delayMs, maxAttempts, kind: 'transport error', url: safeUrl });
      await sleep(delayMs);
      continue;
    }

    if (response.ok || !transientStatus(response.status)) return response;
    if (attempt + 1 >= maxAttempts) return response;

    const serverRetryAfter = retryAfterMs(response);
    if (serverRetryAfter !== undefined && serverRetryAfter > maxRetryAfterMs) {
      throw new Error(
        `GitHub returned HTTP ${response.status} for ${safeUrl} with Retry-After beyond the ${maxRetryAfterMs}ms automatic retry window; refusing an early retry`,
      );
    }
    const delayMs = serverRetryAfter ?? Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
    await onRetry({ attempt, delayMs, maxAttempts, kind: `HTTP ${response.status}`, url: safeUrl });
    await sleep(delayMs);
  }

  throw new Error(`GitHub request exhausted retries for ${safeUrl}`);
}

/**
 * Fetch wrapper with a bounded timeout and optional caller AbortSignal.
 *
 * Prevents indefinite hangs on flaky Tauri custom protocols or slow dev
 * servers, and allows cancellation to propagate into network requests.
 */

export interface FetchWithTimeoutOptions extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal;
}

/**
 * Return an AbortSignal that aborts after `timeoutMs` milliseconds, or
 * immediately when `signal` is already aborted. When `signal` is provided,
 * either abort source will fire the returned signal.
 */
function combineTimeoutWithSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  if (signal?.aborted) {
    return signal;
  }

  const controller = new AbortController();

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  // Best-effort cleanup: when the combined signal is aborted for any reason,
  // clear the timeout so Node/browser timers don't accumulate.
  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timeoutHandle);
    },
    { once: true },
  );

  return controller.signal;
}

/**
 * Fetch `url` with a timeout. If `signal` is aborted first, the request aborts
 * immediately. If the timeout elapses first, the request aborts with a
 * DOMException / AbortError whose message is "The operation was aborted.".
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions,
  timeoutMs: number,
): Promise<Response> {
  const signal = combineTimeoutWithSignal(timeoutMs, options.signal);

  return new Promise<Response>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }

    let settled = false;

    const timeout = setTimeout(() => {
      settled = true;
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, timeoutMs);

    signal.addEventListener(
      'abort',
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
      { once: true },
    );

    fetch(url, { ...options, signal })
      .then(
        (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(response);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        },
      )
      .catch(() => {
        // Defensive: ignore any late errors after the timeout has already
        // rejected, so they don't surface as unhandled rejections.
      });
  });
}

/**
 * Dev/test-only failure injection for the render-worker and image-decode
 * pipeline.
 *
 * Lets tests (and the low-memory test mode) deterministically force the
 * failure paths the app must survive — worker startup failure, postMessage
 * failure, ImageBitmap creation failure — without mocking the whole engine.
 *
 * Safety: the active fault defaults to 'none' and is only ever set by
 * explicit callers (tests / dev diagnostics). Nothing in a normal production
 * session sets it, so it cannot "accidentally remain enabled"; the cost when
 * inactive is a single string compare on hot paths.
 */

export type FaultName = 'none' | 'worker-start' | 'post-message' | 'image-bitmap-create';

let activeFault: FaultName = 'none';

/** Set the fault to inject. 'none' (the default) disables injection. */
export function injectFault(fault: FaultName): void {
  activeFault = fault;
}

/** Current injected fault (test/dev seam). */
export function currentFault(): FaultName {
  return activeFault;
}

/** Returns true when the given fault is active; the hot-path gate. */
export function checkFault(name: FaultName): boolean {
  return activeFault === name;
}

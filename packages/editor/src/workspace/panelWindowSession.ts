/**
 * Per-primary-process identities for auxiliary panel windows.
 *
 * The session id scopes BroadcastChannel traffic to one running editor
 * instance.  It is intentionally ephemeral: a restart cannot accidentally
 * accept a stale auxiliary window from a previous process.  Window ids are
 * allocated before native creation and therefore remain the one canonical
 * identity used by the route, broker, store, and platform service.
 */

let activeSessionId: string | null = null;
let fallbackCounter = 0;

function randomToken(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
  }
  fallbackCounter += 1;
  return `${Date.now().toString(36)}${fallbackCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 14)}`;
}

/** Return the current primary editor's opaque, URL-safe session identity. */
export function getPanelWindowSessionId(): string {
  if (!activeSessionId) {
    activeSessionId = `panel-session-${randomToken().slice(0, 48)}`;
  }
  return activeSessionId;
}

/** Allocate a canonical logical id before a native or popup window is created. */
export function createPanelWindowId(): string {
  return `panel-${randomToken().slice(0, 48)}`;
}

/** Test-only reset; production sessions are deliberately process-lifetime. */
export function resetPanelWindowSessionForTest(): void {
  activeSessionId = null;
  fallbackCounter = 0;
}

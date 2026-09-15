/**
 * Native lifecycle bridge (desktop) — the only place the frontend talks to
 * the Rust termination guard (ADR-0216 D5).
 *
 * Responsibilities:
 *  - listen for `varve://close-requested` / `varve://exit-requested`
 *    (emitted by Rust after it prevented the native close/exit) and route
 *    them through the termination coordinator;
 *  - install the coordinator's commit-time finalize handler: approved
 *    close/exit goes back to Rust as one-shot tokens, so the interception
 *    cannot recurse;
 *  - when no coordinator is installed (no editor mounted — Home only),
 *    approve native requests immediately: nothing dirty can exist.
 */

import {
  getLifecycleCoordinator,
  setLifecycleFinalizeHandler,
  type TerminationIntent,
} from '@varve/editor';
import { isTauriRuntime } from '@varve/platform';

type TauriCore = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type TauriEvent = {
  listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
};
type TauriGlobal = { core: TauriCore; event: TauriEvent };

function getTauri(): TauriGlobal | null {
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  return tauri ?? null;
}

function isMac(): boolean {
  return (navigator.platform?.toLowerCase().includes('mac') ?? false) === true;
}

/** Pure decision: which native action a committed intent requires.
 *  Exported for tests. */
export function resolveNativeFinalize(
  intent: TerminationIntent,
  mac: boolean,
): 'close-window' | 'exit' | 'none' {
  switch (intent) {
    case 'close-window':
      return mac ? 'close-window' : 'exit';
    case 'quit-application':
    case 'restart':
      return 'exit';
    default:
      return 'none';
  }
}

async function approveWindowClose(label: string): Promise<void> {
  await getTauri()?.core.invoke('approve_window_close', { label });
}

async function approveExit(): Promise<void> {
  await getTauri()?.core.invoke('approve_exit');
}

/**
 * Commit-time action for each termination intent (ADR-0216 D9):
 *  - close-window on macOS → close the window; the app keeps running
 *    (red-button convention);
 *  - close-window on Linux/Windows → approve exit (last window close exits
 *    the app, ADR-0211 D3);
 *  - quit-application → approve exit;
 *  - restart → approve exit (updater flow reuses the same guard).
 */
async function finalize(intent: TerminationIntent): Promise<boolean | undefined> {
  const action = resolveNativeFinalize(intent, isMac());
  if (action === 'close-window') {
    await approveWindowClose('main');
  } else if (action === 'exit') {
    await approveExit();
  }
  return undefined;
}

/**
 * Install the bridge. Returns an unsubscribe function. Idempotent.
 */
export function installNativeLifecycleBridge(): () => void {
  if (!isTauriRuntime()) return () => undefined;
  const tauri = getTauri();
  if (!tauri) return () => undefined;

  let disposed = false;
  const unsubscribes: Array<() => void> = [];
  setLifecycleFinalizeHandler(finalize);

  const handleNativeClose = async (payload: unknown) => {
    const label =
      typeof payload === 'object' && payload !== null && 'label' in payload
        ? String((payload as { label: unknown }).label)
        : 'main';
    const coordinator = getLifecycleCoordinator();
    if (!coordinator) {
      await approveWindowClose(label);
      return;
    }
    await coordinator.requestTermination('close-window', 'native-close');
    // The finalize handler performs the approved native close.
  };

  const handleNativeExit = async () => {
    const coordinator = getLifecycleCoordinator();
    if (!coordinator) {
      await approveExit();
      return;
    }
    await coordinator.requestTermination('quit-application', 'native-exit');
  };

  void tauri.event
    .listen('varve://close-requested', (event) => {
      if (!disposed) void handleNativeClose(event.payload);
    })
    .then((unsub) => unsubscribes.push(unsub))
    .catch(() => undefined);
  void tauri.event
    .listen('varve://exit-requested', () => {
      if (!disposed) void handleNativeExit();
    })
    .then((unsub) => unsubscribes.push(unsub))
    .catch(() => undefined);

  return () => {
    disposed = true;
    for (const unsub of unsubscribes) {
      try {
        unsub();
      } catch {
        // Best-effort teardown.
      }
    }
    setLifecycleFinalizeHandler(null);
  };
}

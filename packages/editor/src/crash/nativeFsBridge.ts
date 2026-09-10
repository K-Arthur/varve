/**
 * Native filesystem bridge for the crash-report queue (desktop only).
 *
 * Calls the sandboxed Rust commands in `apps/desktop/src-tauri/src/crash.rs`.
 * The Rust side owns the directory: restrictive permissions, atomic writes,
 * opaque names, size caps, and traversal guards. `invoke` is imported
 * dynamically so web builds never load the Tauri API.
 */

import { type CrashReportStorage, NativeFsCrashReportStorage } from '@varve/crash';

interface TauriCoreModule {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

async function loadTauriCore(): Promise<TauriCoreModule | null> {
  try {
    return (await import('@tauri-apps/api/core')) as TauriCoreModule;
  } catch {
    return null;
  }
}

/**
 * Builds the native storage bridge when the Tauri runtime is available;
 * returns null otherwise (callers fall back to IndexedDB).
 */
export async function createNativeCrashStorage(): Promise<CrashReportStorage | null> {
  const core = await loadTauriCore();
  if (!core) return null;
  try {
    // Probe the runtime: a non-tauri host rejects the call.
    await core.invoke('crash_list_reports');
  } catch {
    return null;
  }
  return new NativeFsCrashReportStorage({
    list: async () => {
      const core = await loadTauriCore();
      if (!core) return [];
      const result = await core.invoke('crash_list_reports');
      return Array.isArray(result) ? (result as string[]) : [];
    },
    read: async (id) => {
      const core = await loadTauriCore();
      if (!core) return null;
      try {
        const result = await core.invoke('crash_read_report', { name: id });
        return typeof result === 'string' ? result : null;
      } catch {
        return null;
      }
    },
    write: async (id, content) => {
      const core = await loadTauriCore();
      if (!core) throw new Error('native storage unavailable');
      await core.invoke('crash_write_report', { name: id, content });
    },
    remove: async (id) => {
      const core = await loadTauriCore();
      if (!core) return;
      await core.invoke('crash_delete_report', { name: id });
    },
  });
}

/** Lists emergency records (Rust panic hook output) awaiting import. */
export async function listEmergencyRecords(): Promise<string[]> {
  const storage = await createNativeCrashStorage();
  if (!storage) return [];
  const ids = await storage.listIds();
  return ids.filter((id) => id.startsWith('emergency-') && id.endsWith('.json'));
}

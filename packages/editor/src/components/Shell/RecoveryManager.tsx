import { isTauriRuntime, type Platform, readNativePreviousCleanShutdown } from '@varve/platform';
import type { Document } from '@varve/scene';
import { useEffect, useState } from 'react';
import { useEditor } from '../../context';
// Leaf import, not the lifecycle barrel: the barrel exports LifecycleProvider
// which imports RecoveryManager — a barrel import here would create a cycle
// (architecture audit enforces zero new cycles).
import {
  getSharedShutdownMarker,
  resolvePreviousCleanShutdown,
} from '../../lifecycle/lifecycleMarker';
import { getSharedRecoveryManager, type RecoverySession } from '../../recovery';
import { RecoveryDialog } from '../RecoveryDialog';

export interface RecoveryManagerProps {
  platform?: Platform;
  document?: Document;
}

/**
 * Startup crash-recovery surface. Shows the recovery dialog when the
 * previous run ended uncleanly (crash / power loss) and stale recovery
 * sessions exist; silently discards stale sessions after a clean shutdown.
 *
 * The clean-shutdown marker itself is owned by the shared ShutdownMarker
 * singleton (read once per app run; written by the termination coordinator
 * at commit) — this component only consumes the read result.
 */
export function RecoveryManager(_props: RecoveryManagerProps) {
  const editor = useEditor();
  const [recoverySessions, setRecoverySessions] = useState<RecoverySession[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    const previousWasClean = getSharedShutdownMarker().begin();
    const mgr = getSharedRecoveryManager();
    let mounted = true;
    void (async () => {
      // Native process termination can happen before WebKit flushes
      // localStorage to disk. The Rust process records this decision in the
      // synchronous SQLite store before approving exit; an unavailable native
      // read is conservatively treated as unclean so recovery data survives.
      const nativeClean = isTauriRuntime() ? await readNativePreviousCleanShutdown() : null;
      const clean = resolvePreviousCleanShutdown(nativeClean, previousWasClean) === true;
      if (!(await mgr.hasSessions()) || !mounted) return;

      if (!clean) {
        const sessions = await mgr.listSessions();
        if (!mounted) return;
        setRecoverySessions(sessions);
        setShowRecovery(true);
        return;
      }

      // Clean shutdown with stale sessions — discard them silently.
      const sessions = await mgr.listSessions();
      for (const session of sessions) void mgr.deleteSession(session.id);
    })().catch(() => {
      // A storage or bridge read failure must never discard recovery data.
      if (mounted) setShowRecovery(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleRecoveryRestore = (id: string) => {
    const mgr = getSharedRecoveryManager();
    mgr.restoreSession(id).then((data) => {
      if (data) {
        // A recovered session is its own document: give it its own tab so
        // restoring never overwrites whatever is open in the active one.
        editor.loadDocument(JSON.stringify(data.document), {
          name: data.tabName,
          newSession: true,
        });
        mgr.deleteSession(id);
      }
    });
  };

  const handleRecoveryDiscard = (id: string) => {
    const mgr = getSharedRecoveryManager();
    mgr.deleteSession(id).then(() => {
      setRecoverySessions((prev) => prev.filter((s) => s.id !== id));
    });
  };

  const handleRecoveryRestoreAll = () => {
    const mgr = getSharedRecoveryManager();
    mgr.listSessions().then((sessions) => {
      for (const session of sessions) {
        mgr.restoreSession(session.id).then((data) => {
          if (data) {
            // One tab per recovered session — restoring all into the active
            // tab left only the last one standing.
            editor.loadDocument(JSON.stringify(data.document), {
              name: data.tabName,
              newSession: true,
            });
            mgr.deleteSession(session.id);
          }
        });
      }
    });
    setShowRecovery(false);
  };

  const handleRecoveryDiscardAll = () => {
    const mgr = getSharedRecoveryManager();
    mgr.listSessions().then((sessions) => {
      for (const s of sessions) {
        mgr.deleteSession(s.id);
      }
    });
    setRecoverySessions([]);
    setShowRecovery(false);
  };

  return (
    <RecoveryDialog
      open={showRecovery}
      sessions={recoverySessions}
      onRestore={handleRecoveryRestore}
      onDiscard={handleRecoveryDiscard}
      onRestoreAll={handleRecoveryRestoreAll}
      onDiscardAll={handleRecoveryDiscardAll}
      onClose={() => setShowRecovery(false)}
    />
  );
}

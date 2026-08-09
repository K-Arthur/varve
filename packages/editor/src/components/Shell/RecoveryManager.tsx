import type { Platform } from '@varve/platform';
import type { Document } from '@varve/scene';
import { useEffect, useState } from 'react';
import { useEditor } from '../../context';
import { getSharedShutdownMarker } from '../../lifecycle';
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
    mgr.hasSessions().then((has) => {
      if (!has) return;
      // Only show the recovery dialog if the previous session ended
      // uncleanly (crash / power loss). A normal close writes a marker.
      const wasUnclean = previousWasClean !== true;
      if (wasUnclean) {
        mgr.listSessions().then((sessions) => {
          setRecoverySessions(sessions);
          setShowRecovery(true);
        });
      } else {
        // Clean shutdown with stale sessions — discard them silently
        mgr.listSessions().then((sessions) => {
          for (const s of sessions) void mgr.deleteSession(s.id);
        });
      }
    });
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

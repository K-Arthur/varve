import type { Platform } from '@strata/platform';
import type { Document } from '@strata/scene';
import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '../../context';
import { getSharedRecoveryManager, type RecoverySession } from '../../recovery';
import { RecoveryDialog } from '../RecoveryDialog';

export interface RecoveryManagerProps {
  platform?: Platform;
  document: Document;
}

/** Marker set on clean shutdown. Absent => the previous session crashed or
/// lost power. Stored in localStorage so it survives app restarts. */
const CLEAN_SHUTDOWN_KEY = 'strata-clean-shutdown';

export function RecoveryManager({
  platform: _platform,
  document: _document,
}: RecoveryManagerProps) {
  const editor = useEditor();
  const [recoverySessions, setRecoverySessions] = useState<RecoverySession[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    // Mark that we're running. On a clean shutdown this gets flipped to true;
    // if it stays false on next launch, the previous session was unclean.
    try {
      localStorage.setItem(CLEAN_SHUTDOWN_KEY, 'false');
    } catch {
      // localStorage unavailable — skip crash detection this session
    }

    const mgr = getSharedRecoveryManager();
    mgr.hasSessions().then((has) => {
      if (!has) return;
      // Only show the recovery dialog if the previous session ended
      // uncleanly (crash / power loss). A normal close writes a marker.
      let wasUnclean = true;
      try {
        wasUnclean = localStorage.getItem(CLEAN_SHUTDOWN_KEY) !== 'true';
      } catch {
        // If we can't read the marker, err on the side of recovery
      }
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

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (editor.state.dirty) {
        editor.save();
        e.preventDefault();
      }
      try {
        localStorage.setItem(CLEAN_SHUTDOWN_KEY, 'true');
      } catch {
        // ignore
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editor, editor.state.dirty]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden && editor.state.dirty) {
        editor.save();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [editor, editor.state.dirty]);

  useEffect(() => {
    const handler = () => {
      if (editor.state.dirty) {
        editor.save();
      }
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [editor, editor.state.dirty]);

  const handleRecoveryRestore = useCallback(
    (id: string) => {
      const mgr = getSharedRecoveryManager();
      mgr.restoreSession(id).then((data) => {
        if (data) {
          editor.loadDocument(JSON.stringify(data.document), { name: data.tabName });
          mgr.deleteSession(id);
        }
      });
    },
    [editor],
  );

  const handleRecoveryDiscard = useCallback((id: string) => {
    const mgr = getSharedRecoveryManager();
    mgr.deleteSession(id).then(() => {
      setRecoverySessions((prev) => prev.filter((s) => s.id !== id));
    });
  }, []);

  const handleRecoveryRestoreAll = useCallback(() => {
    const mgr = getSharedRecoveryManager();
    mgr.listSessions().then((sessions) => {
      for (const session of sessions) {
        mgr.restoreSession(session.id).then((data) => {
          if (data) {
            editor.loadDocument(JSON.stringify(data.document), { name: data.tabName });
            mgr.deleteSession(session.id);
          }
        });
      }
    });
    setShowRecovery(false);
  }, [editor]);

  const handleRecoveryDiscardAll = useCallback(() => {
    const mgr = getSharedRecoveryManager();
    mgr.listSessions().then((sessions) => {
      for (const s of sessions) {
        mgr.deleteSession(s.id);
      }
    });
    setRecoverySessions([]);
    setShowRecovery(false);
  }, []);

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

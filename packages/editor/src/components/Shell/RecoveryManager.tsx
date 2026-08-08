import type { Platform } from '@varve/platform';
import type { Document } from '@varve/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import {
  beginRecoverySession,
  createLifecycleFlushCoordinator,
  type LifecycleFlushCoordinator,
} from '../../persistence/lifecycleFlush';
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
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const [recoverySessions, setRecoverySessions] = useState<RecoverySession[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const flushRef = useRef<LifecycleFlushCoordinator | null>(null);
  if (!flushRef.current) {
    flushRef.current = createLifecycleFlushCoordinator({
      save: () => editorRef.current.save(),
      isDirty: () => editorRef.current.state.dirty,
      getRevision: () => editorRef.current.state.revision,
      markClean: () => {
        try {
          localStorage.setItem(CLEAN_SHUTDOWN_KEY, 'true');
        } catch {
          // localStorage unavailable — recovery remains conservatively unclean
        }
      },
    });
  }

  useEffect(() => {
    const previousWasClean = beginRecoverySession(localStorage, CLEAN_SHUTDOWN_KEY);

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

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const flush = flushRef.current;
      if (!flush) return;
      if (editorRef.current.state.dirty) {
        void flush.request(true);
        event.preventDefault();
      } else {
        flush.markCleanNow();
      }
    };
    const visibilityChange = () => {
      if (document.hidden && editorRef.current.state.dirty) {
        void flushRef.current?.request();
      }
    };
    const pageHide = () => {
      if (editorRef.current.state.dirty) {
        void flushRef.current?.request();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibilityChange);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visibilityChange);
      window.removeEventListener('pagehide', pageHide);
    };
  }, []);

  const handleRecoveryRestore = useCallback(
    (id: string) => {
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

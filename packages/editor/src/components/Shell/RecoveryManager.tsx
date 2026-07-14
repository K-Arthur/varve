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

export function RecoveryManager({
  platform: _platform,
  document: _document,
}: RecoveryManagerProps) {
  const editor = useEditor();
  const [recoverySessions, setRecoverySessions] = useState<RecoverySession[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    const mgr = getSharedRecoveryManager();
    mgr.hasSessions().then((has) => {
      if (has) {
        mgr.listSessions().then((sessions) => {
          setRecoverySessions(sessions);
          setShowRecovery(true);
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

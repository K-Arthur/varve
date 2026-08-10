import { type Platform, upsertPreservingMeta } from '@varve/platform';
import type { Document } from '@varve/scene';
import { useEffect, useRef } from 'react';
import { AutoSaveService } from '../autoSaveService';
import { BackupService } from '../backupService';
import { loadSettings as loadUiSettings } from '../components/Settings/settings';
import type { RecoveryManager } from '../recovery';
import type { EditorState } from './types';

export interface AutoBackupServices {
  autoSaveRef: React.MutableRefObject<AutoSaveService | null>;
  backupRef: React.MutableRefObject<BackupService | null>;
}

/**
 * Owns the auto-save and automatic versioned-backup services for the editor
 * context (crash-recovery points are written through `recoveryRef`, which the
 * caller owns — persistence and lifecycle consumers both read it).
 *
 * Both services are constructed once (guarded by ref presence) and torn down
 * on unmount, so the editor provider never sees their lifecycle.
 */
export function useAutoBackupServices(
  platform: Platform | undefined,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
): AutoBackupServices {
  /** Auto-save service ref for lifecycle-triggered saves. */
  const autoSaveRef = useRef<AutoSaveService | null>(null);
  if (!autoSaveRef.current && platform) {
    const uiSettings = loadUiSettings();
    autoSaveRef.current = new AutoSaveService(
      () => {
        const s = stateRef.current;
        const meta = s.sessions.find((sess) => sess.id === s.activeId);
        return {
          document: s.document,
          meta: { fileId: meta?.fileId, name: meta?.name ?? 'Untitled' },
        };
      },
      async (json) => {
        if (!platform) return false;
        const s = stateRef.current;
        const meta = s.sessions.find((sess) => sess.id === s.activeId);
        try {
          if (meta?.fileId) {
            await upsertPreservingMeta(platform, meta.fileId, meta.name, json);
          } else {
            // Untitled document: persist as recovery point so work is never lost
            const doc = JSON.parse(json) as Document;
            await recoveryRef.current?.createRecoveryPoint(doc, meta?.name ?? 'Untitled');
          }
          return true;
        } catch {
          return false;
        }
      },
      { intervalMs: (uiSettings.general?.autosaveInterval ?? 5) * 60 * 1000 },
    );
    autoSaveRef.current.setOnSaveRecovery(async (doc, meta) => {
      await recoveryRef.current?.createRecoveryPoint(doc, meta.name, meta.fileId);
    });
    autoSaveRef.current.start();
  }
  /** Automatic versioned-backup service (distinct from crash-recovery auto-save). */
  const backupRef = useRef<BackupService | null>(null);
  if (!backupRef.current) {
    backupRef.current = new BackupService();
    void backupRef.current.initialize();
  }
  /** Teardown auto-save + backup on unmount. */
  useEffect(() => {
    return () => {
      autoSaveRef.current?.stop();
      void backupRef.current?.shutdown();
    };
  }, []);
  return { autoSaveRef, backupRef };
}

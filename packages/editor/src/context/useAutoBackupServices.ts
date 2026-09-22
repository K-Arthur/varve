import { type Platform, upsertPreservingMeta } from '@varve/platform';
import type { Document } from '@varve/scene';
import { useEffect, useRef } from 'react';
import { AutoSaveService } from '../autoSaveService';
import { BackupService } from '../backupService';
import { loadSettings as loadUiSettings } from '../components/Settings/settings';
import { createEditorFrameKey, requestEditorFrame } from '../performance/editorFrameRuntime';
import {
  type LockManagerLike,
  shouldSkipStaleWrite,
  withDocumentWriteLock,
} from '../persistence/crossTabWrite';
import { getSharedRecoveryManager, type RecoveryManager } from '../recovery';
import type { EditorState } from './types';

export interface AutoBackupServices {
  autoSaveRef: React.MutableRefObject<AutoSaveService | null>;
  backupRef: React.MutableRefObject<BackupService | null>;
  recoveryRef: React.MutableRefObject<RecoveryManager | null>;
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
  enabled = true,
): AutoBackupServices {
  const recoveryRef = useRef<RecoveryManager | null>(null);
  if (enabled && !recoveryRef.current) {
    recoveryRef.current = getSharedRecoveryManager();
  }
  /** Auto-save service ref for lifecycle-triggered saves. */
  const autoSaveRef = useRef<AutoSaveService | null>(null);
  const autoSaveFrameKeyRef = useRef<string | null>(null);
  const backupFrameKeyRef = useRef<string | null>(null);
  /** Last successful autosave timestamp per file, for cross-tab conflict checks. */
  const lastWrittenAtRef = useRef(new Map<string, number>());
  if (enabled && !autoSaveRef.current && platform) {
    autoSaveFrameKeyRef.current ??= createEditorFrameKey('persistence:autosave');
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
            const fileId = meta.fileId;
            const locks =
              typeof navigator === 'undefined'
                ? undefined
                : ((navigator as Navigator & { locks?: LockManagerLike }).locks ?? undefined);
            return await withDocumentWriteLock(locks, fileId, async () => {
              // Never silently replace a later write from another editor on
              // this origin: if the stored record moved on since this tab's
              // last autosave, skip and keep the local edits dirty/recoverable.
              const entry = await platform.getFile(fileId).catch(() => undefined);
              if (
                shouldSkipStaleWrite(entry?.updatedAt, lastWrittenAtRef.current.get(fileId) ?? null)
              ) {
                if (typeof console !== 'undefined') {
                  console.warn(
                    '[Varve] autosave skipped: the stored copy changed in another editor; edits remain in memory and recovery.',
                  );
                }
                return false;
              }
              await upsertPreservingMeta(platform, fileId, meta.name, json);
              lastWrittenAtRef.current.set(fileId, Date.now());
              return true;
            });
          }
          // Untitled document: persist as recovery point so work is never lost
          const doc = JSON.parse(json) as Document;
          await recoveryRef.current?.createRecoveryPoint(doc, meta?.name ?? 'Untitled');
          return true;
        } catch {
          return false;
        }
      },
      { intervalMs: (uiSettings.general?.autosaveInterval ?? 5) * 60 * 1000 },
      (job) => {
        const key = autoSaveFrameKeyRef.current;
        if (key) requestEditorFrame(key, 'background', () => job());
        else job();
      },
    );
    autoSaveRef.current.setOnSaveRecovery(async (doc, meta) => {
      // saveFn already persisted an untitled document as a recovery point.
      // Writing a second point here duplicated a full-document write (and
      // consumed two cap slots) on every autosave cycle.
      if (!meta.fileId) return;
      await recoveryRef.current?.createRecoveryPoint(doc, meta.name, meta.fileId);
    });
    autoSaveRef.current.start();
  }
  /** Automatic versioned-backup service (distinct from crash-recovery auto-save). */
  const backupRef = useRef<BackupService | null>(null);
  if (enabled && !backupRef.current) {
    backupFrameKeyRef.current ??= createEditorFrameKey('persistence:backup');
    backupRef.current = new BackupService(undefined, {
      scheduleBackground: (job) => {
        const key = backupFrameKeyRef.current;
        if (key) requestEditorFrame(key, 'background', () => job());
        else job();
      },
    });
    void backupRef.current.initialize();
  }
  /** Teardown auto-save + backup on unmount. */
  useEffect(() => {
    return () => {
      autoSaveRef.current?.stop();
      void backupRef.current?.shutdown();
    };
  }, []);
  return { autoSaveRef, backupRef, recoveryRef };
}

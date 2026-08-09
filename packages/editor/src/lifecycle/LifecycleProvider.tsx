/**
 * LifecycleProvider — React host for the termination coordinator.
 *
 * Mounts once inside the editor (Shell.tsx, replacing the RecoveryManager
 * import 1-for-1) and owns:
 *  - installing the coordinator singleton with the live editor API;
 *  - the clean-shutdown marker lifecycle (read once, write at commit);
 *  - dynamic unload protection (beforeunload/pagehide/visibilitychange):
 *    warn only when genuinely unsaved work exists, flush best-effort;
 *  - termination dialogs (single-doc, multi-doc, save-failure);
 *  - commit-time recovery cleanup for intentionally discarded documents;
 *  - the recovery dialog (renders RecoveryManager internally).
 *
 * Deliberately NOT in Shell.tsx/context.tsx (hub budgets + complexity
 * ceilings, ADR-0216) — this is a narrow adapter, not a hub file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { RecoveryManager } from '../components/Shell/RecoveryManager';
import { useEditor } from '../context';
import { getSharedRecoveryManager } from '../recovery';
import { TerminationCoordinator } from './coordinator';
import { createFinalizerRegistry } from './finalizers';
import {
  getLifecycleFinalizeHandler,
  installLifecycleCoordinator,
  uninstallLifecycleCoordinator,
} from './global';
import { getSharedShutdownMarker } from './lifecycleMarker';
import { TerminationDialogHost } from './TerminationDialogHost';
import type {
  EditorLifecycleApi,
  PromptRequest,
  SaveOutcome,
  TerminationIntent,
  TerminationTraceEvent,
  UnsavedDocument,
} from './types';

const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

function devTrace(event: TerminationTraceEvent): void {
  if (!isDev) return;
  // Diagnostics only — never document contents.
  console.debug('[lifecycle]', event.type, event);
}

function mapSaveOutcome(
  ok: boolean,
  saveState: 'idle' | 'saving' | 'saved' | 'error',
): SaveOutcome {
  if (ok) return { ok: true };
  return { ok: false, cancelled: saveState === 'idle' };
}

export function LifecycleProvider({ onBackToHome }: { onBackToHome?: () => void }) {
  const editor = useEditor();
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const [promptRequest, setPromptRequest] = useState<PromptRequest | null>(null);

  const coordinatorRef = useRef<TerminationCoordinator | null>(null);
  if (!coordinatorRef.current) {
    const api: EditorLifecycleApi = {
      getSessions: () => editorRef.current.state.sessions,
      getActiveSessionId: () => editorRef.current.state.activeId,
      isSessionDirty: (id) =>
        editorRef.current.state.sessions.find((s) => s.id === id)?.dirty ?? false,
      closeTab: (id, force) => editorRef.current.closeTab(id, force),
      switchTab: (id) => editorRef.current.switchTab(id),
      getLastSaveFailure: () => 'unknown',
      goHome: () => onBackToHome?.(),
      async saveSession(sessionId) {
        const active = editorRef.current.state.activeId;
        if (sessionId === active) {
          return mapSaveOutcome(await editorRef.current.save(), editorRef.current.state.saveState);
        }
        // Switching tabs is a React state update; `save()` reads stateRef
        // synchronously, so force the render before saving the target.
        flushSync(() => editorRef.current.switchTab(sessionId));
        try {
          return mapSaveOutcome(await editorRef.current.save(), editorRef.current.state.saveState);
        } finally {
          if (active && active !== sessionId) {
            flushSync(() => editorRef.current.switchTab(active));
          }
        }
      },
      async saveSessionAs(sessionId) {
        const active = editorRef.current.state.activeId;
        if (sessionId === active) {
          return mapSaveOutcome(
            await editorRef.current.saveAs(),
            editorRef.current.state.saveState,
          );
        }
        flushSync(() => editorRef.current.switchTab(sessionId));
        try {
          return mapSaveOutcome(
            await editorRef.current.saveAs(),
            editorRef.current.state.saveState,
          );
        } finally {
          if (active && active !== sessionId) {
            flushSync(() => editorRef.current.switchTab(active));
          }
        }
      },
    };

    const marker = getSharedShutdownMarker();
    const finalizers = createFinalizerRegistry();

    const coordinator = new TerminationCoordinator({
      api,
      marker,
      finalizers,
      dialogs: { prompt: (request) => setPromptRequest(request) },
      trace: devTrace,
      onCommit: (intent) => {
        const handler = getLifecycleFinalizeHandler();
        return handler?.(intent);
      },
      onDiscardCommitted: async (docs) => {
        const mgr = getSharedRecoveryManager();
        for (const doc of docs) {
          await mgr.deleteRecoveryForTab(doc.name, doc.fileId);
        }
      },
    });
    coordinatorRef.current = coordinator;
    installLifecycleCoordinator(coordinator);
  }

  useEffect(() => {
    // Arm the shutdown marker once (idempotent shared instance).
    getSharedShutdownMarker().begin();
    return () => {
      uninstallLifecycleCoordinator();
      coordinatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const coordinator = coordinatorRef.current;
      if (!coordinator) return;
      if (coordinator.shouldWarnOnUnload()) {
        // Best-effort flush; never await a save during unload (browsers
        // cannot guarantee it completes). Recovery durability is the
        // real protection.
        coordinator.bestEffortFlush();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onPageHide = () => {
      coordinatorRef.current?.bestEffortFlush();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        coordinatorRef.current?.bestEffortFlush();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const handlePromptRespond = useCallback((request: PromptRequest) => {
    setPromptRequest((current) => (current?.promptId === request.promptId ? null : current));
  }, []);

  return (
    <>
      <RecoveryManager />
      {promptRequest && (
        <TerminationDialogHost
          key={promptRequest.promptId}
          request={promptRequest}
          onResponded={handlePromptRespond}
        />
      )}
    </>
  );
}

// Re-exported for the native bridge / tests.
export type { TerminationIntent, UnsavedDocument };

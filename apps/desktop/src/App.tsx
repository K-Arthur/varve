import {
  afterFirstVisiblePaint,
  CrashCenter,
  currentDocumentSchemaVersion,
  installCrashTestHooks,
  type OpenFileRequest,
  Shell,
  useStartup,
} from '@varve/editor';
import { HomeShell } from '@varve/home';
import { detectPlatform, type FileEntry } from '@varve/platform';
import { StartupLoader, TooltipProvider } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TitleBar } from './chrome/TitleBar';
import { installNativeLifecycleBridge } from './lifecycle/nativeLifecycleBridge';
import { revealMainWindow } from './startup/revealMainWindow';

const platform = detectPlatform();

export function App() {
  const [view, setView] = useState<'home' | 'editor'>('home');
  const [editorMounted, setEditorMounted] = useState(false);
  const [openRequest, setOpenRequest] = useState<OpenFileRequest | null>(null);
  const [homeReady, setHomeReady] = useState(false);
  const pendingHomeMilestone = useRef<(() => void) | null>(null);
  const pendingEditorMilestone = useRef<(() => void) | null>(null);

  const {
    showLoader,
    bootError,
    onRetry,
    retryCount,
    capabilities,
    markHomeDataReady,
    markEditorStateInitialized,
    onHomeReady,
    onEditorReady,
  } = useStartup({});

  const measure = useCallback((name: string, startMark: string) => {
    try {
      performance.measure(name, startMark);
    } catch {
      // User Timing can be unavailable or disabled without blocking startup.
    }
  }, []);

  const handleHomeReady = useCallback(() => {
    markHomeDataReady();
    // Native windows start hidden. Reveal the data-complete surface so RAF can
    // advance, then record readiness only after a paint opportunity.
    void revealMainWindow();
    pendingHomeMilestone.current?.();
    pendingHomeMilestone.current = afterFirstVisiblePaint('.varve-home', () => {
      setHomeReady(true);
      onHomeReady();
      measure('varve-startup', 'app_mount');
      window.dispatchEvent(new CustomEvent('varve:ready', { detail: { mode: 'home' } }));
    });
  }, [markHomeDataReady, measure, onHomeReady]);

  // Hand off from the native splash as soon as React is mounted, rather than
  // waiting for Home's data to finish loading.
  //
  // The native splash window can only be closed from here, so gating it on data
  // readiness meant any failure in that load — an exception, a hung IPC call,
  // a slow first run — left the user on an unclosable splash with no error and
  // nothing to report. Once React is up, `StartupLoader` takes over: it shows
  // branded progress, has its own timeout, and can surface an error with a
  // retry button. That is strictly better than an opaque native window, and it
  // keeps the splash doing the one job it is good at — covering the gap before
  // the webview has painted anything.
  useEffect(() => {
    void revealMainWindow();
  }, []);

  // A boot error must never be invisible. `showLoader` renders the error state,
  // but only if the window is actually on screen.
  useEffect(() => {
    if (bootError) void revealMainWindow();
  }, [bootError]);

  // Native termination bridge: routes CloseRequested/ExitRequested through
  // the coordinator and approves native close/exit at commit (ADR-0216 D5).
  useEffect(() => installNativeLifecycleBridge(), []);

  useEffect(
    () => () => {
      pendingHomeMilestone.current?.();
      pendingEditorMilestone.current?.();
    },
    [],
  );

  /** Guard against duplicate open requests for the same file. */
  const lastOpenIdRef = useRef<string | null>(null);

  const handleOpenFile = useCallback(
    async (entry: FileEntry) => {
      // Dedup: reject rapid duplicate requests for the same file.
      if (lastOpenIdRef.current === entry.id) return;
      lastOpenIdRef.current = entry.id;

      // Validate file existence on desktop before attempting open.
      if (entry.filePath && platform.kind !== 'web') {
        const exists = await platform.fileExists(entry.filePath).catch(() => true);
        if (!exists) {
          // File was moved or deleted. Attempt to read from storage anyway
          // (the document JSON may still be cached).
          const json = await platform.readFile(entry.id).catch(() => null);
          if (!json) {
            // File is truly gone — mark recent entry as missing and abort.
            void platform.patchRecentFile(entry.id, { name: entry.name }).catch(() => undefined);
            return;
          }
          // We have cached content but the file is missing on disk.
          // Still allow opening so the user can Save As.
          void platform.readFile(entry.id).then((json) => {
            if (!json) return;
            void platform.touchFile(entry.id).catch(() => undefined);
            void platform.touchRecentFile(entry.id, entry.name).catch(() => undefined);
            setOpenRequest((prev) => ({
              id: entry.id,
              name: entry.name,
              json,
              filePath: entry.filePath,
              seq: (prev?.seq ?? 0) + 1,
            }));
            markEditorStateInitialized();
            setEditorMounted(true);
            setView('editor');
          });
          return;
        }
      }

      // Normal open: read from storage.
      const json = await platform.readFile(entry.id).catch(() => null);
      if (!json) {
        // Content not found — mark recent entry for cleanup.
        void platform.patchRecentFile(entry.id, { name: entry.name }).catch(() => undefined);
        return;
      }

      // Update timestamps only after successful read.
      void platform.touchFile(entry.id).catch(() => undefined);
      void platform.touchRecentFile(entry.id, entry.name).catch(() => undefined);

      setOpenRequest((prev) => ({
        id: entry.id,
        name: entry.name,
        json,
        filePath: entry.filePath,
        seq: (prev?.seq ?? 0) + 1,
      }));
      markEditorStateInitialized();
      setEditorMounted(true);
      setView('editor');
      pendingEditorMilestone.current?.();
      pendingEditorMilestone.current = afterFirstVisiblePaint(
        '.editor-canvas__content-layer',
        () => {
          onEditorReady();
          measure('varve-editor-first-visible-canvas', 'editor_state_initialized');
          window.dispatchEvent(new CustomEvent('varve:ready', { detail: { mode: 'editor' } }));
        },
      );
    },
    [markEditorStateInitialized, measure, onEditorReady, platform],
  );

  const handleBackToHome = useCallback(() => {
    setView('home');
  }, []);

  const handleResumeEditing = useCallback(() => {
    setView('editor');
    onEditorReady();
  }, [onEditorReady]);

  const surfaceStyle = (visible: boolean): React.CSSProperties => ({
    display: visible ? 'flex' : 'none',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  });

  // Move focus to the newly visible surface on view switch so keyboard and
  // screen-reader users are not dropped to <body> (WCAG 2.4.3 Focus Order).
  useEffect(() => {
    if (!editorMounted) return;
    requestAnimationFrame(() => {
      const target =
        view === 'editor'
          ? document.getElementById('editor-main')
          : document.getElementById('home-main');
      target?.focus();
    });
  }, [view, editorMounted]);

  return (
    <TooltipProvider>
      {showLoader && (
        <StartupLoader
          error={bootError}
          onRetry={bootError ? onRetry : undefined}
          ready={bootError ? false : homeReady}
          simplified={capabilities.shouldSimplify}
        />
      )}
      <CrashCenter
        platformKind={platform.kind}
        readUncleanShutdown={() => localStorage.getItem('strata-clean-shutdown') !== 'true'}
        documentSchemaVersion={currentDocumentSchemaVersion()}
        onControllerReady={(controller) => {
          installCrashTestHooks(controller);
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100dvw',
          height: '100dvh',
          overflow: 'hidden',
        }}
      >
        <TitleBar />
        <div style={surfaceStyle(view === 'home')}>
          <HomeShell
            key={retryCount}
            platform={platform}
            onOpenFile={handleOpenFile}
            onResumeEditing={editorMounted ? handleResumeEditing : undefined}
            onReady={handleHomeReady}
            active={view === 'home'}
          />
        </div>
        {editorMounted && (
          <div style={surfaceStyle(view === 'editor')}>
            <Shell
              onBackToHome={handleBackToHome}
              openFile={openRequest}
              documentJson={openRequest?.json ?? undefined}
              documentName={openRequest?.name ?? undefined}
              documentFileId={openRequest?.id ?? undefined}
              documentFilePath={openRequest?.filePath ?? undefined}
              platform={platform}
              active={view === 'editor'}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

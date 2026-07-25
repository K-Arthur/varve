import { afterFirstVisiblePaint, type OpenFileRequest, Shell, useStartup } from '@strata/editor';
import { HomeShell } from '@strata/home';
import { detectPlatform, type FileEntry } from '@strata/platform';
import { StartupLoader } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TitleBar } from './chrome/TitleBar';
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
    pendingHomeMilestone.current = afterFirstVisiblePaint('.strata-home', () => {
      setHomeReady(true);
      onHomeReady();
      measure('strata-startup', 'app_mount');
      window.dispatchEvent(new CustomEvent('strata:ready', { detail: { mode: 'home' } }));
    });
  }, [markHomeDataReady, measure, onHomeReady]);

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
          void platform.readFile(entry.id)
            .then((json) => {
              if (!json) return;
              void platform.touchFile(entry.id).catch(() => undefined);
              void platform.touchRecentFile(entry.id, entry.name).catch(() => undefined);
              setOpenRequest((prev) => ({
                id: entry.id,
                name: entry.name,
                json,
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
          measure('strata-editor-first-visible-canvas', 'editor_state_initialized');
          window.dispatchEvent(new CustomEvent('strata:ready', { detail: { mode: 'editor' } }));
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

  return (
    <>
      {showLoader && (
        <StartupLoader
          error={bootError}
          onRetry={bootError ? onRetry : undefined}
          ready={bootError ? false : homeReady}
          simplified={capabilities.shouldSimplify}
        />
      )}
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
              platform={platform}
              active={view === 'editor'}
            />
          </div>
        )}
      </div>
    </>
  );
}

import {
  afterFirstVisiblePaint,
  CrashCenter,
  configureDesktopAnalytics,
  currentDocumentSchemaVersion,
  getDesktopAnalytics,
  installCrashTestHooks,
  type OpenFileRequest,
  SettingsDialog,
  SettingsProvider,
  Shell,
  useStartup,
} from '@varve/editor';
import { HomeShell } from '@varve/home';
import {
  createWebPlatform,
  detectPlatform,
  displayNameFromPath,
  type FileEntry,
  upsertPreservingMeta,
} from '@varve/platform';
import { DocumentCodec } from '@varve/scene';
import { StartupLoader, TooltipProvider } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TitleBar } from './chrome/TitleBar';
import { installNativeLifecycleBridge } from './lifecycle/nativeLifecycleBridge';
import { revealMainWindow } from './startup/revealMainWindow';

const desktopAnalytics = configureDesktopAnalytics({
  platform: 'unknown',
  endpoint: import.meta.env.VITE_VARVE_ANALYTICS_ENDPOINT ?? null,
});

const bootPlatform = detectPlatform();

export function App() {
  const [view, setView] = useState<'home' | 'editor'>('home');
  const [editorMounted, setEditorMounted] = useState(false);
  const [openRequest, setOpenRequest] = useState<OpenFileRequest | null>(null);
  const [homeReady, setHomeReady] = useState(false);
  const [homeSettingsOpen, setHomeSettingsOpen] = useState(false);
  const pendingHomeMilestone = useRef<(() => void) | null>(null);
  const pendingEditorMilestone = useRef<(() => void) | null>(null);

  useEffect(() => {
    desktopAnalytics.track('app_launched', { surface: 'desktop' });
    void desktopAnalytics.flush();
    return () => {
      void getDesktopAnalytics().shutdown();
    };
  }, []);

  // In a plain browser the synchronous boot platform is the in-memory
  // fallback; upgrade to the real IndexedDB + File System Access backend as
  // soon as it resolves (it is async to construct by design). The browser
  // build must not silently run on a no-op storage backend.
  const [platform, setPlatform] = useState(bootPlatform);
  useEffect(() => {
    if (bootPlatform.kind !== 'memory') return;
    let cancelled = false;
    void createWebPlatform()
      .then((web) => {
        if (!cancelled) setPlatform(web);
      })
      .catch(() => {
        // No IndexedDB (rare, e.g. strict privacy modes): keep the fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  /**
   * Re-link a Home entry whose physical file was moved or renamed.
   * The user picks a candidate; it is only rebound when it is a valid Varve
   * document AND (when we have cached content) shares the same document
   * identity — filenames alone never rebind. The library id stays stable, so
   * version history, projects, tags and recents all survive the rebind.
   * Returns true when the entry was rebound.
   */
  const handleLocateFile = useCallback(
    async (entry: FileEntry): Promise<boolean> => {
      const picked = await platform.openDocumentFromDisk();
      if (!picked) return false; // picker cancelled — nothing changes

      const decode = (json: string) => {
        try {
          const d = DocumentCodec.decode(json);
          return d.ok ? d.document : null;
        } catch {
          return null;
        }
      };
      const pickedDoc = decode(picked.documentJson);
      if (!pickedDoc) {
        window.alert('That file is not a valid Varve document.');
        return false;
      }
      const cachedJson = await platform.readFile(entry.id).catch(() => null);
      const cachedDoc = cachedJson ? decode(cachedJson) : null;
      if (cachedDoc && cachedDoc.id !== pickedDoc.id) {
        window.alert(
          'That file does not appear to be the same document. Varve only rebinds files that share the same document identity.',
        );
        return false;
      }

      const name = displayNameFromPath(picked.filePath ?? picked.entry.name);
      await upsertPreservingMeta(platform, entry.id, name, picked.documentJson, {
        filePath: picked.filePath,
      });
      void platform.touchFile(entry.id).catch(() => undefined);
      void platform.touchRecentFile(entry.id, name).catch(() => undefined);
      return true;
    },
    [platform],
  );

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
          <SettingsProvider>
            <HomeShell
              key={retryCount}
              platform={platform}
              onOpenFile={handleOpenFile}
              onLocateFile={handleLocateFile}
              onResumeEditing={editorMounted ? handleResumeEditing : undefined}
              onReady={handleHomeReady}
              active={view === 'home'}
              onOpenSettings={() => setHomeSettingsOpen(true)}
            />
            <SettingsDialog open={homeSettingsOpen} onClose={() => setHomeSettingsOpen(false)} />
          </SettingsProvider>
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

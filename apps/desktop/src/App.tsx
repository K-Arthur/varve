import { type OpenFileRequest, Shell, useStartup } from '@strata/editor';
import { HomeShell } from '@strata/home';
import { detectPlatform, type FileEntry } from '@strata/platform';
import { StartupLoader } from '@strata/ui';
import { useCallback, useState } from 'react';
import { TitleBar } from './chrome/TitleBar';

const platform = detectPlatform();

export function App() {
  const [view, setView] = useState<'home' | 'editor'>('home');
  const [editorMounted, setEditorMounted] = useState(false);
  const [openRequest, setOpenRequest] = useState<OpenFileRequest | null>(null);
  const [homeReady, setHomeReady] = useState(false);

  const {
    showLoader,
    bootError,
    onRetry,
    capabilities,
    onHomeReady,
    onEditorReady,
    onBootError,
  } = useStartup({
    onBootComplete: () => {
      performance.measure('strata-startup', 'app_mount');
    },
  });

  const handleHomeReady = useCallback(() => {
    setHomeReady(true);
    onHomeReady();
  }, [onHomeReady]);

  const handleOpenFile = useCallback((entry: FileEntry) => {
    platform
      .readFile(entry.id)
      .catch(() => null)
      .then((json) => {
        setOpenRequest((prev) => ({
          id: entry.id,
          name: entry.name,
          json: json ?? null,
          seq: (prev?.seq ?? 0) + 1,
        }));
        setEditorMounted(true);
        setView('editor');
        onEditorReady();
      });
  }, [onEditorReady]);

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
            platform={platform}
            onOpenFile={handleOpenFile}
            onResumeEditing={editorMounted ? handleResumeEditing : undefined}
            onReady={handleHomeReady}
          />
        </div>
        {editorMounted && (
          <div style={surfaceStyle(view === 'editor')}>
            <Shell
              onBackToHome={handleBackToHome}
              openFile={openRequest}
              platform={platform}
              active={view === 'editor'}
            />
          </div>
        )}
      </div>
    </>
  );
}

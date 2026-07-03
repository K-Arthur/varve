import { type OpenFileRequest, Shell } from '@strata/editor';
import { HomeShell } from '@strata/home';
import { detectPlatform, type FileEntry } from '@strata/platform';
import { useCallback, useState } from 'react';
import { TitleBar } from './chrome/TitleBar';

const platform = detectPlatform();

export function App() {
  const [view, setView] = useState<'home' | 'editor'>('home');
  // The editor stays mounted once opened so tabs/sessions survive trips to
  // the home screen; `view` only toggles which surface is visible.
  const [editorMounted, setEditorMounted] = useState(false);
  const [openRequest, setOpenRequest] = useState<OpenFileRequest | null>(null);

  const handleOpenFile = useCallback((entry: FileEntry) => {
    // Read the document BEFORE switching views. Dispatching the open first
    // and patching JSON in later raced the editor mount: the shell came up
    // with the previous file's content (stale frames in a "new" file).
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
      });
  }, []);

  const handleBackToHome = useCallback(() => {
    setView('home');
  }, []);

  const handleResumeEditing = useCallback(() => {
    setView('editor');
  }, []);

  const surfaceStyle = (visible: boolean): React.CSSProperties => ({
    display: visible ? 'flex' : 'none',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  });

  return (
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
        />
      </div>
      {editorMounted && (
        <div style={surfaceStyle(view === 'editor')}>
          <Shell
            onBackToHome={handleBackToHome}
            openFile={openRequest}
            active={view === 'editor'}
          />
        </div>
      )}
    </div>
  );
}

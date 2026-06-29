import { Shell } from '@strata/editor';
import { HomeShell } from '@strata/home';
import { detectPlatform, type FileEntry } from '@strata/platform';
import { useCallback, useState } from 'react';
import { TitleBar } from './chrome/TitleBar';

const platform = detectPlatform();

export function App() {
  const [view, setView] = useState<'home' | 'editor'>('home');
  const [pendingFile, setPendingFile] = useState<FileEntry | null>(null);
  const [pendingJson, setPendingJson] = useState<string | null>(null);

  const handleOpenFile = useCallback((entry: FileEntry) => {
    setPendingFile(entry);
    setView('editor');
    platform.readFile(entry.id).then((json) => {
      setPendingJson(json ?? null);
    }).catch(() => setPendingJson(null));
  }, []);

  const handleBackToHome = useCallback(() => {
    setPendingFile(null);
    setPendingJson(null);
    setView('home');
  }, []);

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
      {view === 'home' ? (
        <HomeShell platform={platform} onOpenFile={handleOpenFile} />
      ) : (
        <ShellWithFile
          pendingFile={pendingFile}
          pendingJson={pendingJson}
          onBackToHome={handleBackToHome}
        />
      )}
    </div>
  );
}

function ShellWithFile({
  pendingFile,
  pendingJson,
  onBackToHome,
}: {
  pendingFile: FileEntry | null;
  pendingJson: string | null;
  onBackToHome: () => void;
}) {
  return (
    <Shell
      onBackToHome={onBackToHome}
      documentJson={pendingJson ?? undefined}
      documentName={pendingFile?.name}
    />
  );
}

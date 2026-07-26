import { useCallback, useState } from 'react';

export interface DialogState {
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;
  showArchiveDialog: boolean;
  archiveDialogMode: 'backup' | 'restore';
  setShowArchiveDialog: (show: boolean, mode?: 'backup' | 'restore') => void;
}

export function useDialogState(): DialogState {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialogState] = useState(false);
  const [archiveDialogMode, setArchiveDialogMode] = useState<'backup' | 'restore'>('backup');
  const setShowArchiveDialog = useCallback(
    (show: boolean, mode: 'backup' | 'restore' = 'backup') => {
      setArchiveDialogMode(mode);
      setShowArchiveDialogState(show);
    },
    [],
  );
  return {
    showExportDialog,
    setShowExportDialog,
    showArchiveDialog,
    archiveDialogMode,
    setShowArchiveDialog,
  };
}

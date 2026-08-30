import { useCallback, useState } from 'react';

export interface DialogState {
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;
  showArchiveDialog: boolean;
  archiveDialogMode: 'backup' | 'restore';
  setShowArchiveDialog: (show: boolean, mode?: 'backup' | 'restore') => void;
  /** Curated effect browser, hosted by the primary editor dialog layer. */
  effectStudioDialogOpen: boolean;
  openEffectStudioDialog: () => void;
  closeEffectStudioDialog: () => void;
}

export function useDialogState(): DialogState {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialogState] = useState(false);
  const [archiveDialogMode, setArchiveDialogMode] = useState<'backup' | 'restore'>('backup');
  const [effectStudioDialogOpen, setEffectStudioDialogOpen] = useState(false);
  const setShowArchiveDialog = useCallback(
    (show: boolean, mode: 'backup' | 'restore' = 'backup') => {
      setArchiveDialogMode(mode);
      setShowArchiveDialogState(show);
    },
    [],
  );
  const openEffectStudioDialog = useCallback(() => setEffectStudioDialogOpen(true), []);
  const closeEffectStudioDialog = useCallback(() => setEffectStudioDialogOpen(false), []);
  return {
    showExportDialog,
    setShowExportDialog,
    showArchiveDialog,
    archiveDialogMode,
    setShowArchiveDialog,
    effectStudioDialogOpen,
    openEffectStudioDialog,
    closeEffectStudioDialog,
  };
}

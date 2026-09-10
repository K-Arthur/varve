/**
 * ThumbnailPickerHost — mounts the File Thumbnail dialog from the
 * module-level picker bridge. The host owns open state so every entry point
 * (File menu, canvas context menu, page context menu, command palette)
 * opens the same dialog without threading state through hub files.
 */

import { useEffect, useState } from 'react';
import { useEditor } from '../../context';
import { setThumbnailPickerHandler } from '../../thumbnail/thumbnailPickerBridge';
import { ThumbnailPickerDialog } from './ThumbnailPickerDialog';

export function ThumbnailPickerHost() {
  const { state } = useEditor();
  const [open, setOpen] = useState(false);
  const fileId = state.sessions.find((s) => s.id === state.activeId)?.fileId;

  useEffect(() => {
    setThumbnailPickerHandler(() => setOpen(true));
    return () => setThumbnailPickerHandler(null);
  }, []);

  useEffect(() => {
    if (open && !fileId) {
      // No saved file yet — keep the dialog openable but hint via the
      // dialog itself; close immediately is friendlier.
      setOpen(false);
    }
  }, [open, fileId]);

  return <ThumbnailPickerDialog open={open} onClose={() => setOpen(false)} />;
}

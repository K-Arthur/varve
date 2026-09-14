/**
 * FontBrowserDialog — modal wrapper for font discovery. Browsing and license
 * inspection live here; applying a family or an exact registered face to the
 * selection stays in the Typography section, which remains the authoritative
 * editing surface.
 */

import { Dialog } from '@varve/ui';
import { useEffect, useRef } from 'react';
import { FontBrowser, type FontFaceSelection } from './FontBrowser';

export interface FontBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (family: string) => void;
  onSelectFace?: (selection: FontFaceSelection) => void;
  selectedFamily?: string;
  documentId?: string;
}

export function FontBrowserDialog({
  open,
  onClose,
  onSelect,
  onSelectFace,
  selectedFamily,
  documentId,
}: FontBrowserDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Node && dialogRef.current?.contains(event.target)) return;
      // A crash/recovery dialog or text editor can retain focus while this
      // modal is promoted into the top layer. Capture Escape at the document
      // boundary so the font workflow always dismisses before that stale
      // owner handles the key.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [onClose, open]);

  return (
    <Dialog
      ref={dialogRef}
      open={open}
      onClose={onClose}
      title="Browse fonts"
      size="lg"
      focusFirstControl
      className="font-browser-dialog"
    >
      <FontBrowser
        layout="modal"
        showDownloadable
        selectedFamily={selectedFamily}
        documentId={documentId}
        onSelect={onSelect}
        onSelectFace={onSelectFace}
      />
    </Dialog>
  );
}

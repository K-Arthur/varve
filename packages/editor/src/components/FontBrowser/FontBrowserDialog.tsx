/**
 * FontBrowserDialog — modal wrapper for font discovery. Browsing and license
 * inspection live here; applying a family to the selection stays in the
 * Typography section, which remains the authoritative editing surface.
 */

import { Dialog } from '@varve/ui';
import { FontBrowser } from './FontBrowser';

export interface FontBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (family: string) => void;
  selectedFamily?: string;
}

export function FontBrowserDialog({
  open,
  onClose,
  onSelect,
  selectedFamily,
}: FontBrowserDialogProps) {
  return (
    <Dialog
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
        onSelect={onSelect}
      />
    </Dialog>
  );
}

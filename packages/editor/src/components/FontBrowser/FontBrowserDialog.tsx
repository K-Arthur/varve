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
}

export function FontBrowserDialog({ open, onClose, onSelect }: FontBrowserDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Browse fonts">
      <FontBrowser showDownloadable onSelect={onSelect} />
    </Dialog>
  );
}

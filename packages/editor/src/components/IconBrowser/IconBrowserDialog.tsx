/**
 * IconBrowserDialog — modal wrapper that inserts icons from the icon browser
 * into the active document as document icon assets (embedded, sanitized SVG
 * with provenance). The insertion runs through the editor facade
 * (`insertIconAsset`), so it participates in undo, selection, and
 * document-icon asset bookkeeping.
 */

import { Dialog } from '@strata/ui';
import { useCallback, useState } from 'react';
import { useEditor } from '../../context';
import { IconBrowser, type IconInsertPayload } from './IconBrowser';

export interface IconBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  /** When set, replaces these node ids instead of inserting new content. */
  replaceNodeIds?: string[];
  title?: string;
}

export function IconBrowserDialog({
  open,
  onClose,
  replaceNodeIds,
  title = 'Insert icon',
}: IconBrowserDialogProps) {
  const editor = useEditor();
  const [inserting, setInserting] = useState(false);

  const handleInsert = useCallback(
    async (payload: IconInsertPayload) => {
      if (inserting) return;
      setInserting(true);
      const request = {
        name: payload.name,
        providerId: payload.providerId ?? (payload.prefix ? 'iconify' : undefined),
        prefix: payload.prefix,
        svg: payload.svg,
        licence: payload.licence,
      };
      try {
        const inserted =
          replaceNodeIds && replaceNodeIds.length > 0
            ? await editor.replaceIconAsset(replaceNodeIds, request)
            : await editor.insertIconAsset(request);
        if (inserted) {
          onClose();
        }
      } finally {
        setInserting(false);
      }
    },
    [editor, replaceNodeIds, onClose, inserting],
  );

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <IconBrowser onInsert={handleInsert} />
    </Dialog>
  );
}

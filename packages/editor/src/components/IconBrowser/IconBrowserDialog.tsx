/**
 * IconBrowserDialog — modal wrapper for quick icon insertion. Insertions
 * run through the editor facade (`insertIconAsset` / `replaceIconAsset`),
 * so they participate in undo, selection, and document icon-asset
 * bookkeeping. The dialog stays open on failure so the user can retry or
 * choose another icon.
 */

import { Dialog } from '@varve/ui';
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
  const [lastError, setLastError] = useState<string | null>(null);

  const handleInsert = useCallback(
    async (payload: IconInsertPayload) => {
      if (inserting) return;
      setInserting(true);
      setLastError(null);
      const request = {
        name: payload.name,
        providerId: payload.providerId ?? (payload.prefix ? 'iconify' : undefined),
        prefix: payload.prefix,
        svg: payload.svg,
        licence: payload.licence,
        spdxId: payload.spdxId,
        licenceUrl: payload.licenceUrl,
        attributionText: payload.attributionText,
        author: payload.author,
        sourceUrl: payload.sourceUrl,
        sourceVersion: payload.sourceVersion,
        paletteType: payload.paletteType,
        style: 'outline' as const,
      };
      try {
        const inserted =
          replaceNodeIds && replaceNodeIds.length > 0
            ? await editor.replaceIconAsset(replaceNodeIds, request)
            : await editor.insertIconAsset(request);
        if (inserted) {
          onClose();
        } else {
          setLastError('Could not insert this icon into the document.');
        }
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Could not insert this icon.');
      } finally {
        setInserting(false);
      }
    },
    [editor, replaceNodeIds, onClose, inserting],
  );

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {lastError && (
        <div className="icon-dialog__error" role="alert">
          {lastError}
        </div>
      )}
      <IconBrowser onInsert={handleInsert} compact />
    </Dialog>
  );
}

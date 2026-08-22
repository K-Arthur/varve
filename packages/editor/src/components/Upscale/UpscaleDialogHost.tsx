/**
 * UpscaleDialogHost — renders the enhance dialog and loads the source image.
 *
 * Reads the selected image nodes, decodes the first to a data URL for
 * preview, and passes its dimensions to the dialog. On apply, delegates to
 * the editor context's upscaleSelectedImage once per selected image —
 * sequentially, with per-image progress announcements (batch enhancement).
 */

import type { UpscaleProgressFn } from '@varve/engine';
import { getImageCache } from '@varve/engine';
import { getImageFill } from '@varve/scene';
import type { NodeId } from '@varve/scene';
import { useEffect, useState } from 'react';
import { useEditor } from '../../context';
import { selectedImageShapes } from '../../imageOperations';
import { UpscaleDialog } from './UpscaleDialog';
import { useUpscaleDialog } from './useUpscaleDialog';

interface UpscaleDialogHostProps {
  open: boolean;
  onClose: () => void;
}

interface SourceInfo {
  dataUrl: string;
  imageData: ImageData | null;
  width: number;
  height: number;
  /** All selected image node ids — batch enhancement processes each. */
  batchNodeIds: NodeId[];
}

export function UpscaleDialogHost({ open, onClose }: UpscaleDialogHostProps) {
  const { state, closeUpscaleDialog, announce } = useEditor();
  const { handleDialogApply } = useUpscaleDialog();
  const [source, setSource] = useState<SourceInfo | null>(null);

  useEffect(() => {
    if (!open) {
      setSource(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const imageNodes = selectedImageShapes(state.document, state.selection);
      if (imageNodes.length === 0) return;

      // Preview comes from the first selected image; batch covers all.
      const shapeNode = imageNodes[0]!;
      const imageFill = getImageFill(shapeNode);
      const imageFillData =
        imageFill?.type === 'image' && imageFill.image ? imageFill.image : undefined;

      const naturalWidth =
        imageFillData?.imageWidth ?? (shapeNode.shape.kind === 'rect' ? shapeNode.shape.w : 0);
      const naturalHeight =
        imageFillData?.imageHeight ?? (shapeNode.shape.kind === 'rect' ? shapeNode.shape.h : 0);

      if (!imageFillData?.src || naturalWidth === 0 || naturalHeight === 0) return;

      try {
        const cache = getImageCache();
        const img = await cache.load(imageFillData.src);
        if (cancelled) return;

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const dataUrl = canvas.toDataURL('image/png');
        if (cancelled) return;

        setSource({
          dataUrl,
          imageData,
          width: img.width,
          height: img.height,
          batchNodeIds: imageNodes.map((n) => n.id),
        });
      } catch {
        // ignore — dialog will show without preview
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, state.document, state.selection]);

  if (!open) return null;

  return (
    <UpscaleDialog
      sourceWidth={source?.width ?? 0}
      sourceHeight={source?.height ?? 0}
      sourceDataUrl={source?.dataUrl ?? ''}
      sourceImageData={source?.imageData ?? undefined}
      batchCount={source?.batchNodeIds.length ?? 1}
      open={open}
      onClose={onClose}
      onApply={async (options) => {
        const nodeIds = source?.batchNodeIds ?? [];
        const total = nodeIds.length;
        if (total <= 1) {
          await handleDialogApply(options);
          closeUpscaleDialog();
          return;
        }
        // Batch: sequential per-image apply with combined progress. Each
        // call targets an explicit node so a changed selection mid-run
        // cannot redirect work to the wrong layer.
        let failed = 0;
        for (let i = 0; i < total; i++) {
          const nodeId = nodeIds[i]!;
          announce(`Enhancing image ${i + 1} of ${total}…`);
          const wrappedProgress: UpscaleProgressFn = (done, tileTotal) => {
            options.onProgress(i * tileTotal + done, tileTotal * total);
          };
          try {
            await handleDialogApply({ ...options, nodeId, onProgress: wrappedProgress });
          } catch (error) {
            if ((error as Error).message === 'cancelled') throw error;
            failed++;
          }
        }
        announce(
          failed === 0
            ? `Enhanced ${total} images`
            : `Enhanced ${total - failed} of ${total} images; ${failed} failed`,
        );
        closeUpscaleDialog();
      }}
    />
  );
}

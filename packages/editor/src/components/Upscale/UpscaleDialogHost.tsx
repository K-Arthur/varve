/**
 * UpscaleDialogHost — renders the upscale dialog and loads the source image.
 *
 * Reads the selected image node, decodes it to a data URL for preview,
 * and passes the source dimensions to the dialog. On apply, delegates
 * to the editor context's upscaleSelectedImage.
 */

import { getImageCache } from '@varve/engine';
import { getImageFill, isImageShape } from '@varve/scene';
import { useEffect, useState } from 'react';
import { useEditor } from '../../context';
import { selectedImageShape } from '../../imageOperations';
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
}

export function UpscaleDialogHost({ open, onClose }: UpscaleDialogHostProps) {
  const { state, closeUpscaleDialog, announce } = useEditor();
  const { handleDialogApply } = useUpscaleDialog();
  const [source, setSource] = useState<SourceInfo | null>(null);

  // Batch enhancement is not yet supported — select one image at a time.
  useEffect(() => {
    if (open && state.selection.length > 1) {
      announce('Enhance works on one image at a time. Select a single image layer.');
      closeUpscaleDialog();
    }
  }, [open, state.selection.length, announce, closeUpscaleDialog]);

  useEffect(() => {
    if (!open) {
      setSource(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const imageNode = selectedImageShape(state.document, state.selection);
      if (!imageNode) return;

      const shapeNode =
        imageNode.kind === 'shape' ? (imageNode as import('@varve/scene').ShapeNode) : undefined;
      const imageFill = shapeNode && isImageShape(shapeNode) ? getImageFill(shapeNode) : undefined;
      const imageFillData =
        imageFill?.type === 'image' && imageFill.image ? imageFill.image : undefined;

      const naturalWidth =
        imageFillData?.imageWidth ?? (shapeNode?.shape.kind === 'rect' ? shapeNode.shape.w : 0);
      const naturalHeight =
        imageFillData?.imageHeight ?? (shapeNode?.shape.kind === 'rect' ? shapeNode.shape.h : 0);

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
      open={open}
      onClose={onClose}
      onApply={async (options) => {
        await handleDialogApply(options);
        closeUpscaleDialog();
      }}
    />
  );
}

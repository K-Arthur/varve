/**
 * useUpscaleDialog — manages the upscale dialog lifecycle.
 *
 * Provides open/close state, source image loading, and wires the dialog
 * to the document model via upscaleSelectedImage.
 */

import type { UpscaleModeId, UpscaleProgressFn } from '@strata/engine';
import { useCallback, useState } from 'react';
import { useEditor } from '../../context';

export interface UpscaleDialogOpenOptions {
  mode?: UpscaleModeId;
  replaceSource?: boolean;
}

interface UpscaleDialogState {
  open: boolean;
  sourceWidth: number;
  sourceHeight: number;
  sourceDataUrl: string;
  initialMode: UpscaleModeId;
  initialReplaceSource: boolean;
}

interface UseUpscaleDialogReturn {
  dialogState: UpscaleDialogState;
  openUpscaleDialog: (options?: UpscaleDialogOpenOptions) => void;
  closeUpscaleDialog: () => void;
  handleDialogApply: (options: {
    mode: UpscaleModeId;
    scale: number;
    output: 'new-layer' | 'replace-source';
    onProgress: UpscaleProgressFn;
  }) => Promise<void>;
}

const INITIAL_STATE: UpscaleDialogState = {
  open: false,
  sourceWidth: 0,
  sourceHeight: 0,
  sourceDataUrl: '',
  initialMode: 'balanced',
  initialReplaceSource: false,
};

export function useUpscaleDialog(): UseUpscaleDialogReturn {
  const { upscaleSelectedImage } = useEditor();
  const [dialogState, setDialogState] = useState<UpscaleDialogState>(INITIAL_STATE);

  const openUpscaleDialog = useCallback((options: UpscaleDialogOpenOptions = {}) => {
    setDialogState({
      open: true,
      sourceWidth: 0,
      sourceHeight: 0,
      sourceDataUrl: '',
      initialMode: options.mode ?? 'balanced',
      initialReplaceSource: options.replaceSource ?? false,
    });
  }, []);

  const closeUpscaleDialog = useCallback(() => {
    setDialogState(INITIAL_STATE);
  }, []);

  const handleDialogApply = useCallback(
    async (options: {
      mode: UpscaleModeId;
      scale: number;
      output: 'new-layer' | 'replace-source';
      onProgress: UpscaleProgressFn;
    }) => {
      const method =
        options.mode === 'ai-enhance'
          ? 'ai'
          : options.mode === 'pixel-art'
            ? 'nearest'
            : options.mode === 'fast'
              ? 'bilinear'
              : options.mode === 'balanced'
                ? 'bicubic'
                : 'lanczos3';
      await upscaleSelectedImage({
        scale: options.scale,
        method,
        modelId: options.mode === 'ai-enhance' ? 'upscale-realesr-general' : undefined,
        onProgress: options.onProgress,
        replaceSource: options.output === 'replace-source',
      });
    },
    [upscaleSelectedImage],
  );

  return {
    dialogState,
    openUpscaleDialog,
    closeUpscaleDialog,
    handleDialogApply,
  };
}

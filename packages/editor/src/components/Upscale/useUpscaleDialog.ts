import type {
  DenoiseStrength,
  PixelArtAlgorithm,
  UpscaleModeId,
  UpscaleProgressFn,
} from '@strata/engine';
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
    denoiseStrength: DenoiseStrength;
    pixelArtAlgorithm?: PixelArtAlgorithm;
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
  const editor = useEditor();
  const { upscaleSelectedImage } = editor;
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
      denoiseStrength: DenoiseStrength;
      pixelArtAlgorithm?: PixelArtAlgorithm;
      onProgress: UpscaleProgressFn;
    }) => {
      const needsEnhancement =
        options.denoiseStrength !== 'none' ||
        (options.mode === 'pixel-art' &&
          options.pixelArtAlgorithm &&
          options.pixelArtAlgorithm !== 'nearest');

      if (needsEnhancement) {
        const { applyEnhancement } = await import('./applyEnhancement');
        await applyEnhancement(editor, {
          mode: options.mode,
          scale: options.scale,
          output: options.output,
          denoiseStrength: options.denoiseStrength,
          pixelArtAlgorithm: options.pixelArtAlgorithm,
          onProgress: options.onProgress,
        });
        return;
      }

      const method =
        options.mode === 'ai-enhance' || options.mode === 'illustration'
          ? 'ai'
          : options.mode === 'pixel-art'
            ? 'nearest'
            : options.mode === 'fast'
              ? 'bilinear'
              : options.mode === 'balanced'
                ? 'bicubic'
                : 'lanczos3';
      const modelId =
        options.mode === 'ai-enhance'
          ? 'upscale-realesr-general'
          : options.mode === 'illustration'
            ? 'upscale-realesrgan-anime'
            : undefined;
      await upscaleSelectedImage({
        scale: options.scale,
        method,
        modelId,
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

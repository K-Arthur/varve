import type {
  DenoiseStrength,
  PixelArtAlgorithm,
  UpscaleModeId,
  UpscaleProgressFn,
} from '@varve/engine';
import { cachedImageDims } from '@varve/engine';
import type { EditorContextValue } from '../../context/types';
import { insertDerivedImageShape, selectedImageShape } from '../../imageOperations';

export interface ApplyEnhancementOptions {
  mode: UpscaleModeId;
  scale: number;
  output: 'new-layer' | 'replace-source';
  denoiseStrength: DenoiseStrength;
  pixelArtAlgorithm?: PixelArtAlgorithm;
  onProgress: UpscaleProgressFn;
}

export async function applyEnhancement(
  editor: EditorContextValue,
  options: ApplyEnhancementOptions,
): Promise<void> {
  const { mode, scale, output, denoiseStrength, pixelArtAlgorithm, onProgress } = options;
  const { state, updateDoc, announce } = editor;
  const { document, selection } = state;

  const imageNode = selectedImageShape(document, selection);
  if (!imageNode) {
    announce?.('Select an image layer first');
    return;
  }

  const engine = await import('@varve/engine');
  const scene = await import('@varve/scene');

  const { getImageCache, runEnhancementPipeline, scalePixelArt } = engine;
  const { imageShapeSrc, getImageFill, findOrCreateEmbeddedAsset, mimeTypeFromDataUrl } = scene;

  const sourceSrc = imageShapeSrc(imageNode);
  const image = await getImageCache().load(sourceSrc);
  const { width, height } = cachedImageDims(image);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  const canvas = globalThis.document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas pixel processing is unavailable');
  ctx.drawImage(image, 0, 0, safeWidth, safeHeight);
  const source = ctx.getImageData(0, 0, safeWidth, safeHeight);

  let outputImage: ImageData;

  const usePixelArt = mode === 'pixel-art' && pixelArtAlgorithm && pixelArtAlgorithm !== 'nearest';

  if (denoiseStrength !== 'none') {
    const pipelineResult = await runEnhancementPipeline({
      source,
      denoiseStrength,
      upscaleMethod: usePixelArt
        ? 'nearest'
        : mode === 'ai-enhance' || mode === 'illustration'
          ? 'ai'
          : mode === 'fast'
            ? 'bilinear'
            : mode === 'balanced'
              ? 'bicubic'
              : 'lanczos3',
      upscaleScale: scale,
      upscaleModelId:
        mode === 'ai-enhance'
          ? 'upscale-realesr-general'
          : mode === 'illustration'
            ? 'upscale-realesrgan-anime'
            : undefined,
      pixelArtAlgorithm: usePixelArt ? pixelArtAlgorithm : undefined,
      onProgress,
    });
    outputImage = pipelineResult.imageData;
  } else if (usePixelArt) {
    outputImage = scalePixelArt(source, {
      algorithm: pixelArtAlgorithm!,
      scale,
    });
  } else {
    throw new Error('applyEnhancement called without enhancement needed');
  }

  const outputCanvas = globalThis.document.createElement('canvas');
  outputCanvas.width = outputImage.width;
  outputCanvas.height = outputImage.height;
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) throw new Error('Canvas image encoding is unavailable');
  outputCtx.putImageData(outputImage, 0, 0);
  const dataUrl = outputCanvas.toDataURL('image/png');

  const processingNodeId = imageNode.id;
  const fill = getImageFill(imageNode);
  const assetInput = {
    dataUrl,
    mimeType: mimeTypeFromDataUrl(dataUrl),
    naturalWidth: outputImage.width,
    naturalHeight: outputImage.height,
  };

  const currentFill = fill?.type === 'image' && fill.image ? fill.image : undefined;
  const baseFill = {
    type: 'image' as const,
    opacity: fill?.opacity ?? 1,
    blendMode: fill?.blendMode ?? ('normal' as const),
    visible: fill?.visible ?? true,
    image: {
      src: dataUrl,
      fit: currentFill?.fit ?? ('fill' as const),
      x: currentFill?.x ?? 0,
      y: currentFill?.y ?? 0,
      scale: currentFill?.scale ?? 1,
      imageWidth: outputImage.width,
      imageHeight: outputImage.height,
    },
  };

  if (output === 'replace-source') {
    updateDoc((doc) => {
      const node = doc.nodes[processingNodeId];
      if (node?.kind !== 'shape') return doc;
      const { document: docWithAsset, assetId } = findOrCreateEmbeddedAsset(doc, assetInput);
      return {
        ...docWithAsset,
        nodes: {
          ...docWithAsset.nodes,
          [processingNodeId]: {
            ...node,
            fills: [{ ...baseFill, image: { ...baseFill.image, assetId } }],
          },
        },
      };
    });
  } else {
    updateDoc((doc) => {
      const node = doc.nodes[processingNodeId];
      if (node?.kind !== 'shape') return doc;
      const { document: docWithAsset, assetId } = findOrCreateEmbeddedAsset(doc, assetInput);
      const updatedDoc = {
        ...docWithAsset,
        nodes: {
          ...docWithAsset.nodes,
          [processingNodeId]: {
            ...node,
            fills: [{ ...baseFill, image: { ...baseFill.image, assetId } }],
          },
        },
      };
      const result = insertDerivedImageShape(updatedDoc, processingNodeId, {
        dataUrl,
        width: outputImage.width,
        height: outputImage.height,
        suffix: `-${scale}x`,
      });
      return result.doc;
    });
  }
}

import { getImageCache, removeBackground } from '@varve/engine';
import type { BackgroundRemovalMethod, Document, SceneNode } from '@varve/scene';
import { resolveNodePaints } from '@varve/scene';
import {
  commitPreparedBackgroundRemoval,
  type PreparedBackgroundRemoval,
} from './commitRasterMask';

/** Prepare a frozen export snapshot; publication remains owned by the caller. */
export async function prepareExportCutouts(
  document: Document | undefined,
  nodes: SceneNode[],
  method: BackgroundRemovalMethod,
  signal: AbortSignal,
) {
  let preparedDocument = document;
  const preparedMasks: PreparedBackgroundRemoval[] = [];
  for (const node of nodes) {
    if (node.kind !== 'shape' || node.backgroundRemoval || node.mask?.rasterMask) continue;
    const fills = (
      document
        ? resolveNodePaints({ fills: node.fills, paintRefs: node.paintRefs }, document)
        : (node.fills ?? [])
    ).filter((fill) => fill.type === 'image' && fill.image);
    if (fills.length === 0) continue;
    if (fills.length !== 1) throw new Error(`Choose a single image fill for ${node.name}`);
    const sourceImage = fills[0]!.image!;
    if (signal.aborted) throw new Error('cancelled');
    const src = sourceImage.src;
    const image = await getImageCache().load(src);
    if (signal.aborted) throw new Error('cancelled');
    const width =
      ('naturalWidth' in image ? image.naturalWidth : image.width) || sourceImage.imageWidth || 0;
    const height =
      ('naturalHeight' in image ? image.naturalHeight : image.height) ||
      sourceImage.imageHeight ||
      0;
    if (width <= 0 || height <= 0) throw new Error('The source image has invalid dimensions');
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable');
    context.drawImage(image, 0, 0, width, height);
    const result = await removeBackground(
      context.getImageData(0, 0, width, height),
      {
        method,
        feather: 0.5,
        decontaminate: false,
      },
      signal,
    );
    if (signal.aborted) throw new Error('cancelled');
    if (method !== 'quick' && result.method === 'quick')
      throw new Error('The AI provider returned a Quick result');
    const prepared: PreparedBackgroundRemoval = {
      width: result.width,
      height: result.height,
      sourceNode: node,
      sourceLocator: src,
      sourceImage,
      sourceAsset: sourceImage.assetId ? document?.assets?.[sourceImage.assetId] : undefined,
      documentId: document?.id,
      modelId: result.modelId,
      runtime:
        result.executionProvider === 'native'
          ? 'native-cpu'
          : (result.executionProvider ?? 'typescript'),
      maskDataUrl: result.maskDataUrl,
      method: result.method,
      confidence: result.confidence,
      appliedAt: Date.now(),
      feather: 0.5,
      decontaminate: false,
    };
    if (preparedDocument)
      preparedDocument = commitPreparedBackgroundRemoval(preparedDocument, node.id, prepared);
    preparedMasks.push(prepared);
  }
  return { preparedDocument, preparedMasks };
}

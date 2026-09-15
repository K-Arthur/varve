import { commitFloatingSelection, type FloatingRasterSelection } from '@varve/engine';
import { createEmbeddedAsset, type Document, getImageFill, isImageShape } from '@varve/scene';

export interface FloatingImageCommit {
  document: Document;
  transformedSelection: import('@varve/engine').AreaSelection | null;
}

function encodePng(data: Uint8ClampedArray, width: number, height: number): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Commit a floating buffer as a copy-on-write image asset. */
export async function commitFloatingImage(
  document: Document,
  floating: FloatingRasterSelection,
): Promise<FloatingImageCommit | null> {
  const node = document.nodes[floating.targetNodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return null;
  const image = getImageFill(node)?.image;
  const fills = node.fills;
  if (!image || !fills) return null;
  const result = commitFloatingSelection(floating);
  if (!result) return null;
  const dataUrl = encodePng(result.compositedPixels, result.width, result.height);
  if (!dataUrl) return null;
  const asset = createEmbeddedAsset({
    dataUrl,
    mimeType: 'image/png',
    naturalWidth: result.width,
    naturalHeight: result.height,
  });
  return {
    transformedSelection: result.transformedSelection,
    document: {
      ...document,
      assets: { ...document.assets, [asset.id]: asset },
      nodes: {
        ...document.nodes,
        [node.id]: {
          ...node,
          fills: fills.map((fill) =>
            fill.type === 'image' && fill.image
              ? { ...fill, image: { ...fill.image, assetId: asset.id, src: dataUrl } }
              : fill,
          ),
        },
      },
    },
  };
}

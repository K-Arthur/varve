import type { Document, Fill, ImageFillData, SceneNode } from '@strata/scene';
import { useCallback } from 'react';

export interface UpscaleOutputOptions {
  output: 'new-layer' | 'replace-source' | 'non-destructive';
  replaceSource?: boolean;
  method: string;
  scale: number;
  modelId?: string;
}

export interface UpscaleOutputContext {
  document: Document;
  processingNodeId: string;
  dataUrl: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  currentFill?: ImageFillData;
  fill?: Fill;
}

export function useUpscaleOutputHandler(
  updateDoc: (fn: (doc: Document) => Document) => void,
  patch: (partial: { selection?: string[] }) => void,
  insertDerivedImageShape: (
    doc: Document,
    sourceId: string,
    opts: { dataUrl: string; width: number; height: number; suffix: string },
  ) => { doc: Document; nodeId: string },
  findOrCreateEmbeddedAsset: (
    doc: Document,
    asset: { dataUrl: string; mimeType: string; naturalWidth: number; naturalHeight: number },
  ) => { document: Document; assetId: string },
): (options: UpscaleOutputOptions, ctx: UpscaleOutputContext) => void {
  return useCallback(
    (options, ctx) => {
      const {
        document: doc,
        processingNodeId,
        dataUrl,
        mimeType,
        naturalWidth,
        naturalHeight,
        currentFill,
        fill,
      } = ctx;

      const assetInput = { dataUrl, mimeType, naturalWidth, naturalHeight };

      if (options.replaceSource || options.output === 'replace-source') {
        updateDoc((document) => {
          const node = document.nodes[processingNodeId];
          if (node?.kind !== 'shape') return document;
          const { document: docWithAsset, assetId } = findOrCreateEmbeddedAsset(
            document,
            assetInput,
          );
          const imageFill: ImageFillData = {
            src: dataUrl,
            assetId,
            fit: currentFill?.fit ?? 'fill',
            x: currentFill?.x ?? 0,
            y: currentFill?.y ?? 0,
            scale: currentFill?.scale ?? 1,
            imageWidth: naturalWidth,
            imageHeight: naturalHeight,
          };
          return {
            ...docWithAsset,
            nodes: {
              ...docWithAsset.nodes,
              [processingNodeId]: {
                ...node,
                fills: [
                  {
                    type: 'image',
                    opacity: fill?.opacity ?? 1,
                    blendMode: fill?.blendMode ?? 'normal',
                    visible: fill?.visible ?? true,
                    image: imageFill,
                  },
                ],
              } as SceneNode,
            },
          };
        });
      } else if (options.output === 'non-destructive') {
        updateDoc((document) => {
          const node = document.nodes[processingNodeId];
          if (node?.kind !== 'shape') return document;
          const { document: docWithAsset, assetId: upscaleAssetId } = findOrCreateEmbeddedAsset(
            document,
            assetInput,
          );
          const sourceAssetId = currentFill?.assetId;
          const imageFill: ImageFillData = {
            src: dataUrl,
            assetId: upscaleAssetId,
            fit: currentFill?.fit ?? 'fill',
            x: currentFill?.x ?? 0,
            y: currentFill?.y ?? 0,
            scale: currentFill?.scale ?? 1,
            imageWidth: naturalWidth,
            imageHeight: naturalHeight,
            upscale: sourceAssetId
              ? {
                  sourceAssetId,
                  upscaleAssetId,
                  mode: options.method ?? 'unknown',
                  scale: options.scale ?? 2,
                  modelId: options.modelId,
                }
              : undefined,
          };
          return {
            ...docWithAsset,
            nodes: {
              ...docWithAsset.nodes,
              [processingNodeId]: {
                ...node,
                fills: [
                  {
                    type: 'image',
                    opacity: fill?.opacity ?? 1,
                    blendMode: fill?.blendMode ?? 'normal',
                    visible: fill?.visible ?? true,
                    image: imageFill,
                  },
                ],
              } as SceneNode,
            },
          };
        });
      } else {
        const scaleLabel = options.method === 'ai' ? '4x-ai' : `${options.scale ?? 2}x`;
        const inserted = insertDerivedImageShape(doc, processingNodeId, {
          dataUrl,
          width: naturalWidth,
          height: naturalHeight,
          suffix: scaleLabel,
        });
        updateDoc(() => inserted.doc);
        patch({ selection: [inserted.nodeId] });
      }
    },
    [updateDoc, patch, insertDerivedImageShape, findOrCreateEmbeddedAsset],
  );
}

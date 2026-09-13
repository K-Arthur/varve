import {
  type Document,
  findOrCreateEmbeddedAsset,
  imageShapeSrc,
  isImageShape,
  mimeTypeFromDataUrl,
  type NodeId,
} from '@varve/scene';
import { insertDerivedImageShape } from './imageOperations';

export interface ColorizationCommitInput {
  sourceId: NodeId;
  /** Source fill identity captured when the request started. */
  sourceSrc: string;
  dataUrl: string;
  width: number;
  height: number;
  suffix: string;
}

/**
 * Commit a materialized colorization result against the latest document.
 *
 * The source identity check prevents a late worker result from being placed
 * beside a replaced/deleted source. The functional caller still owns the
 * history transaction; this helper only constructs the next document and
 * stores the output bytes in the document asset table for save/reopen/export.
 */
export function commitColorizationResult(
  doc: Document,
  input: ColorizationCommitInput,
): { doc: Document; nodeId: NodeId; assetId: string } {
  const source = doc.nodes[input.sourceId];
  if (source?.kind !== 'shape' || !isImageShape(source)) {
    throw new Error('Colorize result is stale because the source is no longer an image');
  }
  if (imageShapeSrc(source) !== input.sourceSrc) {
    throw new Error('Colorize result is stale because the source image changed');
  }

  const assetResult = findOrCreateEmbeddedAsset(doc, {
    dataUrl: input.dataUrl,
    mimeType: mimeTypeFromDataUrl(input.dataUrl),
    naturalWidth: input.width,
    naturalHeight: input.height,
  });
  const inserted = insertDerivedImageShape(assetResult.document, input.sourceId, {
    dataUrl: input.dataUrl,
    width: input.width,
    height: input.height,
    suffix: input.suffix,
    assetId: assetResult.assetId,
  });
  return { doc: inserted.doc, nodeId: inserted.nodeId, assetId: assetResult.assetId };
}

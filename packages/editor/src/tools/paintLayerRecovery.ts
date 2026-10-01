import { type Document, makeRasterLayerNode, nextNodeId } from '@varve/scene';
import { addNodeToActiveWorkspace, isPublishingPageSurface } from '../scene/activeWorkspace';

/** Build an empty pixel layer on the current editor surface for paint recovery. */
export function createPaintLayerForRecovery(
  document: Document,
  workspaceMode: string,
  name = 'Paint Layer',
): { document: Document; nodeId: string } {
  const { id, doc: allocated } = nextNodeId(document);
  const page = document.pages?.find((candidate) => candidate.id === document.activePageId);
  const ppi = document.paintingPpi ?? document.dpi ?? 96;
  const pixelScale = Math.max(1, ppi / 96);
  const pageSurface = isPublishingPageSurface(document, workspaceMode);
  const width = pageSurface ? (page?.width ?? 4096) : 4096;
  const height = pageSurface ? (page?.height ?? 4096) : 4096;
  const layer = makeRasterLayerNode(
    id,
    {
      width: Math.ceil(width * pixelScale),
      height: Math.ceil(height * pixelScale),
    },
    { name },
  );
  if (pixelScale !== 1) {
    layer.transform = [1 / pixelScale, 0, 0, 1 / pixelScale, 0, 0];
  }
  return {
    document: addNodeToActiveWorkspace(allocated, layer, workspaceMode),
    nodeId: id,
  };
}

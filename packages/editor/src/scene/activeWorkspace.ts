/**
 * Where editor-created layers belong.
 *
 * A document owns multiple surfaces: Design Canvas content and Publishing
 * Page content. Editor commands must insert into the active surface's
 * content root, not the raw document root — nodes appended to `rootChildren`
 * render but never appear in the Layers panel or the page they belong to.
 */

import {
  addChild,
  addNode,
  type Document,
  designCanvasContentRoot,
  type NodeId,
  type SceneNode,
} from '@varve/scene';

/**
 * Resolve the content owner for editor-created layers. Design Canvas content
 * is intentionally unavailable to publishing-page workflows; those commands
 * target the active publishing Page instead.
 */
export function activeWorkspaceContentRoot(doc: Document, workspaceMode: string): NodeId | null {
  if (!isPublishingPageSurface(doc, workspaceMode)) return designCanvasContentRoot(doc);
  return doc.pages?.find((page) => page.id === doc.activePageId)?.contentRoot ?? null;
}

export function isPublishingPageSurface(doc: Document, workspaceMode: string): boolean {
  return workspaceMode === 'print' || (workspaceMode === 'drawing' && Boolean(doc.workflowProfile));
}

export function addNodeToActiveWorkspace(
  doc: Document,
  node: SceneNode,
  workspaceMode: string,
): Document {
  const rootId = activeWorkspaceContentRoot(doc, workspaceMode);
  return rootId && doc.nodes[rootId] ? addChild(doc, rootId, node) : addNode(doc, node);
}

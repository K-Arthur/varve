/**
 * Editor adapters for the typed page.* operation family.
 *
 * The scene operations remain the canonical mutation semantics. These small
 * adapters validate stale UI payloads before applying them, then hand the
 * resulting document to the editor's existing updateDoc/history boundary.
 */

import {
  applyOperation,
  type Document,
  type NodeId,
  type PageCreatePayload,
  type PageDeletePayload,
  type PageLayoutPayload,
  type PageMoveOnPasteboardPayload,
  type PageRenamePayload,
  type PageResizePayload,
  preconditionFailure,
  registerBuiltinOperations,
  validatePayload,
} from '@varve/scene';

let operationsReady = false;

function ensurePageOperations(): void {
  if (operationsReady) return;
  registerBuiltinOperations();
  operationsReady = true;
}

function applyPageOperation<TPayload>(doc: Document, type: string, payload: TPayload): Document {
  ensurePageOperations();
  const validated = validatePayload(type, payload);
  if (!validated.ok) return doc;
  if (preconditionFailure(doc, type, validated.value)) return doc;
  return applyOperation(doc, type, validated.value);
}

export function createPageCommand(doc: Document, payload: PageCreatePayload): Document {
  return applyPageOperation(doc, 'page.create', payload);
}

export function renamePageCommand(doc: Document, payload: PageRenamePayload): Document {
  return applyPageOperation(doc, 'page.rename', payload);
}

export function deletePageCommand(
  doc: Document,
  pageId: NodeId,
  policy: PageDeletePayload['policy'] = 'move-to-pasteboard',
  targetPageId?: NodeId,
): Document {
  return applyPageOperation(doc, 'page.delete', { pageId, policy, targetPageId });
}

export function duplicatePageCommand(doc: Document, pageId: NodeId): Document {
  return applyPageOperation(doc, 'page.duplicate', { pageId });
}

export function reorderPagesCommand(doc: Document, pageIds: NodeId[]): Document {
  return applyPageOperation(doc, 'page.reorder', { pageIds });
}

export function resizePageCommand(doc: Document, payload: PageResizePayload): Document {
  return applyPageOperation(doc, 'page.resize', payload);
}

export function movePageCommand(doc: Document, payload: PageMoveOnPasteboardPayload): Document {
  return applyPageOperation(doc, 'page.move-on-pasteboard', payload);
}

export function setPageLayoutCommand(doc: Document, payload: PageLayoutPayload): Document {
  return applyPageOperation(doc, 'page.set-layout', payload);
}

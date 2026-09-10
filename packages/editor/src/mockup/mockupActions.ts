/**
 * Mockup creation actions.
 *
 * All mutations go through the editor's normal `updateDoc` + transaction
 * path, so applying a mockup is a single undoable step. The source design
 * stays in place; the mockup frame is created beside it and selected.
 */

import {
  addChild,
  addMockupTemplate,
  addNode,
  createMockupInstanceData,
  type Document,
  getBuiltinMockupTemplate,
  getBuiltinMockupTemplates,
  type MockupSourceBinding,
  type MockupTemplateAsset,
  makeFrameNode,
  type NodeId,
  nextNodeId,
  resolveOwnership,
} from '@varve/scene';
import { type Affine, multiplyAffine, tryInvertAffine } from '@varve/shared';
import type { EditorContextValue } from '../context';
import { requestMockupsTab } from './mockupTabStore';

/** Template asset with a cached reference (builtin or document-embedded). */
export interface ResolvedMockupTemplate {
  template: MockupTemplateAsset;
  templateId: string;
}

/** Open the Mockups tab, remembering the current selection as sources. */
export function openMockupsWithSelection(editor: EditorContextValue): void {
  requestMockupsTab(editor.state.selection.length > 0 ? editor.state.selection : undefined);
  if (!editor.state.libraryPanelVisible) {
    editor.toggleLibraryPanel();
  }
}

/** Resolve a template for use in a document (builtin catalog or embedded). */
export function resolveTemplateForDocument(
  doc: Document,
  templateId: string,
): ResolvedMockupTemplate | null {
  const embedded = doc.mockupTemplates?.[templateId];
  if (embedded) return { template: embedded, templateId };
  const builtin = getBuiltinMockupTemplate(templateId);
  if (builtin) return { template: builtin, templateId };
  return null;
}

/** Effective surface binding for a template slot and source. */
export function bindingForSource(
  sourceIds: NodeId[],
  surfaceIndex: number,
  preserveLink: boolean,
): MockupSourceBinding {
  const sourceId = sourceIds[surfaceIndex % sourceIds.length];
  if (!preserveLink || !sourceId) {
    return { mode: 'snapshot' as const };
  }
  return { mode: 'live', nodeId: sourceId };
}

/**
 * Resolve the logical editing surface that owns a source node.  Page and
 * Design Canvas content roots are deliberately hidden implementation groups;
 * adding a new mockup directly to `rootChildren` would bypass the active
 * surface and make it disappear from the canvas and Layers panel.
 */
function mockupInsertionParent(doc: Document, sourceId: NodeId): NodeId | null {
  const owner = resolveOwnership(doc, sourceId);
  switch (owner.kind) {
    case 'designCanvas':
      return (
        doc.designCanvases?.find((canvas) => canvas.id === owner.designCanvasId)?.contentRoot ??
        null
      );
    case 'page':
      return doc.pages?.find((page) => page.id === owner.pageId)?.contentRoot ?? null;
    case 'master':
      return doc.masters?.[owner.masterId]?.contentRoot ?? null;
    default:
      return null;
  }
}

/** Convert the desired pasteboard position into the target surface's local space. */
function mockupTransformForParent(
  editor: EditorContextValue,
  parentId: NodeId | null,
  x: number,
  y: number,
): Affine {
  const world: Affine = [1, 0, 0, 1, x, y];
  if (!parentId) return world;
  const inverse = tryInvertAffine(editor.getWorldTransform(parentId));
  return inverse ? multiplyAffine(inverse, world) : world;
}

/**
 * Apply a template to the given source nodes: creates a mockup frame beside
 * the first source, embeds the template asset (deduped), binds surfaces to
 * the sources (cycled for multi-surface templates), and selects the frame.
 * One undoable transaction.
 */
export function applyMockupToSources(
  editor: EditorContextValue,
  templateId: string,
  sourceIds: NodeId[],
  preserveLink = true,
): NodeId | null {
  const doc = editor.state.document;
  const resolved = resolveTemplateForDocument(doc, templateId);
  if (!resolved || sourceIds.length === 0) return null;

  const sourceNode = doc.nodes[sourceIds[0]!];
  if (!sourceNode) return null;

  const { template } = resolved;
  // Reserve the ID synchronously. `updateDoc` evaluates its updater during
  // React's state flush, so an ID assigned inside that updater is not
  // available when the post-transaction selection is applied.
  const templateDoc = addMockupTemplate(doc, template).document;
  const { id: createdNodeId } = nextNodeId(templateDoc);

  // Placement: to the right of the first source, fitted to ~600px height.
  const sourceBounds = editor.getWorldBounds(sourceIds[0]!);
  const targetH = 600;
  const frameW = template.outputWidth * (targetH / template.outputHeight);
  const frameH = targetH;
  const x = (sourceBounds?.x ?? 0) + (sourceBounds?.w ?? 400) + 80;
  const y = sourceBounds?.y ?? 0;
  const parentId = mockupInsertionParent(doc, sourceIds[0]!);
  const transform = mockupTransformForParent(editor, parentId, x, y);

  const bindings: Record<string, MockupSourceBinding> = {};
  template.surfaces.forEach((surface, index) => {
    bindings[surface.id] = bindingForSource(sourceIds, index, preserveLink);
  });

  editor.beginTransaction();
  try {
    editor.updateDoc((current) => {
      const added = addMockupTemplate(current, template);
      const withTemplate = added.document;
      const resolvedTemplateId = added.templateId;
      const { doc: next } = nextNodeId(withTemplate);
      const nodeId = createdNodeId;
      const frame = makeFrameNode(nodeId, {
        transform,
        w: frameW,
        h: frameH,
        name: `${template.name} mockup`,
        clipContent: false,
      });
      const mockupFrame = {
        ...frame,
        mockup: createMockupInstanceData(resolvedTemplateId, bindings),
      };
      return parentId && next.nodes[parentId]
        ? addChild(next, parentId, mockupFrame)
        : addNode(next, mockupFrame);
    });
  } finally {
    editor.commitTransaction();
  }
  editor.setSelection(createdNodeId);
  return createdNodeId;
}

/** Apply the given template to the current selection (single/multi). */
export function applyMockupToSelection(
  editor: EditorContextValue,
  templateId: string,
): NodeId | null {
  const selection = editor.state.selection;
  if (selection.length === 0) return null;
  return applyMockupToSources(editor, templateId, selection, true);
}

/** Templates suitable for the current selection (all builtins + embedded). */
export function templatesForDocument(doc: Document): MockupTemplateAsset[] {
  const builtins = getBuiltinMockupTemplates();
  const embedded = Object.values(doc.mockupTemplates ?? {}).filter(
    (t) => !builtins.some((b) => b.id === t.id),
  );
  return [...builtins, ...embedded];
}

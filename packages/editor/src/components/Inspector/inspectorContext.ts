import { buildParentIndexMap, type Document, type NodeId, type SceneNode } from '@varve/scene';
import type { EditorState } from '../../context/types';
import type { ToolId } from '../../tools/types';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';

export type InspectorScope =
  | 'document'
  | 'canvas'
  | 'page'
  | 'master'
  | 'selection'
  | 'table-cell'
  | 'pixel-selection'
  | 'temporary-workflow'
  | 'tool';

export type InspectorSelectionKind = 'empty' | 'single' | 'multi';

export interface InspectorTarget {
  scope: InspectorScope;
  id: string | null;
  label: string;
  nodeKind?: SceneNode['kind'];
}

export interface InspectorRestrictionState {
  directLockedNodeIds: readonly NodeId[];
  inheritedLockedNodeIds: readonly NodeId[];
  effectiveLockedNodeIds: readonly NodeId[];
  directHiddenNodeIds: readonly NodeId[];
  inheritedHiddenNodeIds: readonly NodeId[];
  effectiveHiddenNodeIds: readonly NodeId[];
  lockSourceIds: readonly NodeId[];
  visibilitySourceIds: readonly NodeId[];
  editableNodeIds: readonly NodeId[];
  canEditSelection: boolean;
  canSeeSelectionFeedback: boolean;
  hasPartialLock: boolean;
  hasPartialHidden: boolean;
}

export interface InspectorContext {
  documentId: string;
  workspaceMode: WorkspaceMode;
  activeTool: ToolId;
  prototypeMode: boolean;
  scope: InspectorScope;
  target: InspectorTarget;
  selectionKind: InspectorSelectionKind;
  selectedNodeIds: readonly NodeId[];
  primaryNodeId: NodeId | null;
  focusedNodeId: NodeId | null;
  sharedNodeKind?: SceneNode['kind'];
  activeTextRange: EditorState['selectionRange'];
  tableEdit: EditorState['tableEdit'];
  hasPixelSelection: boolean;
  restrictions: InspectorRestrictionState;
}

export type InspectorContextInput = Pick<
  EditorState,
  | 'document'
  | 'workspaceMode'
  | 'tool'
  | 'prototypeMode'
  | 'selection'
  | 'primaryId'
  | 'focusedNodeId'
  | 'selectionRange'
  | 'tableEdit'
  | 'currentPageId'
  | 'masterEditId'
  | 'areaSelection'
  | 'quickMask'
> & {
  selectedNodes?: readonly SceneNode[];
};

const NON_WORKFLOW_TOOLS = new Set<ToolId>(['select', 'hand', 'zoom']);
const TEMPORARY_WORKFLOW_TOOLS = new Set<ToolId>(['crop', 'warp', 'selectionPaint']);

function nodeIdsWithRestriction(
  nodes: readonly SceneNode[],
  parentIndex: ReadonlyMap<NodeId, NodeId>,
  nodesById: ReadonlyMap<NodeId, SceneNode>,
  key: 'locked' | 'visible',
): {
  direct: NodeId[];
  inherited: NodeId[];
  effective: NodeId[];
  sourceIds: NodeId[];
} {
  const direct: NodeId[] = [];
  const inherited: NodeId[] = [];
  const effective: NodeId[] = [];
  const sourceIds: NodeId[] = [];

  for (const node of nodes) {
    const directRestricted = key === 'locked' ? node.locked : node.visible === false;
    if (directRestricted) {
      direct.push(node.id);
      effective.push(node.id);
      sourceIds.push(node.id);
      continue;
    }

    const visited = new Set<NodeId>();
    let parentId = parentIndex.get(node.id);
    let sourceId: NodeId | null = null;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = nodesById.get(parentId);
      if (parent && (key === 'locked' ? parent.locked : parent.visible === false)) {
        sourceId = parent.id;
        break;
      }
      parentId = parentIndex.get(parentId);
    }

    if (sourceId) {
      inherited.push(node.id);
      effective.push(node.id);
      sourceIds.push(sourceId);
    }
  }

  return { direct, inherited, effective, sourceIds: [...new Set(sourceIds)] };
}

function restrictionState(
  document: Document,
  nodes: readonly SceneNode[],
): InspectorRestrictionState {
  const nodesById = new Map<NodeId, SceneNode>(
    Object.values(document.nodes).map((node) => [node.id, node]),
  );
  const parentIndex = buildParentIndexMap(document);
  const locked = nodeIdsWithRestriction(nodes, parentIndex, nodesById, 'locked');
  const hidden = nodeIdsWithRestriction(nodes, parentIndex, nodesById, 'visible');

  const editableNodeIds = nodes
    .filter((node) => !locked.effective.includes(node.id))
    .map((node) => node.id);
  return {
    directLockedNodeIds: locked.direct,
    inheritedLockedNodeIds: locked.inherited,
    effectiveLockedNodeIds: locked.effective,
    directHiddenNodeIds: hidden.direct,
    inheritedHiddenNodeIds: hidden.inherited,
    effectiveHiddenNodeIds: hidden.effective,
    lockSourceIds: locked.sourceIds,
    visibilitySourceIds: hidden.sourceIds,
    editableNodeIds,
    canEditSelection: nodes.length > 0 && locked.effective.length === 0,
    canSeeSelectionFeedback: nodes.length > 0 && hidden.effective.length === 0,
    hasPartialLock: locked.effective.length > 0 && locked.effective.length < nodes.length,
    hasPartialHidden: hidden.effective.length > 0 && hidden.effective.length < nodes.length,
  };
}

function pageTarget(document: Document, state: InspectorContextInput): InspectorTarget | null {
  const pageId = state.currentPageId ?? document.activePageId;
  if (state.workspaceMode !== 'print' || !pageId) return null;
  const page = document.pages?.find((candidate) => candidate.id === pageId);
  return page ? { scope: 'page', id: page.id, label: page.name } : null;
}

function canvasTarget(document: Document): InspectorTarget | null {
  const canvasId = document.activeDesignCanvasId;
  if (!canvasId) return null;
  const canvas = document.designCanvases?.find((candidate) => candidate.id === canvasId);
  return canvas ? { scope: 'canvas', id: canvas.id, label: canvas.name } : null;
}

function targetFor(
  document: Document,
  state: InspectorContextInput,
  nodes: readonly SceneNode[],
): InspectorTarget {
  const hasPixelSelection = Boolean(state.areaSelection || state.quickMask.active);
  if (hasPixelSelection) {
    return {
      scope: 'pixel-selection',
      id: state.currentPageId ?? document.activePageId ?? null,
      label: state.quickMask.active ? 'Quick mask' : 'Pixel selection',
    };
  }

  if (state.masterEditId && document.masters?.[state.masterEditId]) {
    return {
      scope: 'master',
      id: state.masterEditId,
      label: document.masters[state.masterEditId]!.name,
    };
  }

  if (state.tableEdit && document.nodes[state.tableEdit.tableId]?.kind === 'table') {
    const table = document.nodes[state.tableEdit.tableId]!;
    return {
      scope: 'table-cell',
      id: table.id,
      label: `${table.name} cells`,
      nodeKind: table.kind,
    };
  }

  if (nodes.length > 0) {
    const primary = nodes.find((node) => node.id === state.primaryId) ?? nodes[0]!;
    const sharedKind = nodes.every((node) => node.kind === nodes[0]?.kind);
    return {
      scope: TEMPORARY_WORKFLOW_TOOLS.has(state.tool) ? 'temporary-workflow' : 'selection',
      id: primary.id,
      label:
        nodes.length === 1
          ? primary.name
          : `${nodes.length} ${sharedKind ? `${primary.kind} ` : ''}selected`,
      nodeKind: sharedKind ? primary.kind : undefined,
    };
  }

  if (NON_WORKFLOW_TOOLS.has(state.tool) === false) {
    return { scope: 'tool', id: state.tool, label: `${state.tool} options` };
  }

  return (
    pageTarget(document, state) ??
    canvasTarget(document) ?? {
      scope: 'document',
      id: document.id,
      label: document.name,
    }
  );
}

/**
 * Derive the Inspector's target and restrictions from authoritative editor
 * state. This is a read model: it is not serialized, does not own selection,
 * and never mutates the document.
 */
export function deriveInspectorContext(input: InspectorContextInput): InspectorContext {
  const selectedIds = input.selectedNodes?.map((node) => node.id) ?? input.selection;
  const nodes = selectedIds
    .map((id) => input.document.nodes[id])
    .filter((node): node is SceneNode => node !== undefined)
    .slice();
  const selectedNodeIds = nodes.map((node) => node.id);
  const firstKind = nodes[0]?.kind;
  const sharedNodeKind =
    firstKind && nodes.every((node) => node.kind === firstKind) ? firstKind : undefined;
  const target = targetFor(input.document, input, nodes);
  const selectionKind: InspectorSelectionKind =
    nodes.length === 0 ? 'empty' : nodes.length === 1 ? 'single' : 'multi';

  return {
    documentId: input.document.id,
    workspaceMode: input.workspaceMode,
    activeTool: input.tool,
    prototypeMode: input.prototypeMode,
    scope: target.scope,
    target,
    selectionKind,
    selectedNodeIds,
    primaryNodeId: selectedNodeIds.includes(input.primaryId ?? '')
      ? input.primaryId
      : (selectedNodeIds[0] ?? null),
    focusedNodeId:
      input.focusedNodeId && input.document.nodes[input.focusedNodeId] ? input.focusedNodeId : null,
    sharedNodeKind,
    activeTextRange: input.selectionRange,
    tableEdit:
      input.tableEdit && input.document.nodes[input.tableEdit.tableId]?.kind === 'table'
        ? input.tableEdit
        : null,
    hasPixelSelection: Boolean(input.areaSelection || input.quickMask.active),
    restrictions: restrictionState(input.document, nodes),
  };
}

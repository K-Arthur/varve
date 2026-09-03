import type { Shape } from '@varve/engine';
import {
  addMask,
  type BooleanOpKind,
  createLiveBooleanDoc,
  type Document,
  defaultVectorMaskForNode,
  type FrameNode,
  isBooleanOperand,
  type MaskType,
  makeFrameNode,
  type SceneNode,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import type { KnifeCutOutcome, KnifeSelectionPatch } from './knifeCommand';
import type { ToolId } from './types';

export type { AlignmentReference } from '../scene/selectionArrangement';
export {
  alignSelectionInDocument,
  alignSelectionWithObbInDocument,
  commonAlignmentContainerBounds,
  distributeSelectionInDocument,
} from '../scene/selectionArrangement';
export type { KnifeCutOutcome, KnifeCutState, KnifeSelectionPatch } from './knifeCommand';
export { runKnifeCut } from './knifeCommand';
export type { KnifeLine, KnifeSkip, KnifeSkipReason, KnifeSliceResult } from './knifeSlice';

/** Run a synchronous editor mutation as one transaction when no outer gesture owns it. */
export function runOwnedTransaction(
  transactionRef: { current: boolean },
  begin: () => void,
  commit: () => void,
  action: () => void,
): void {
  const ownsTransaction = !transactionRef.current;
  if (ownsTransaction) begin();
  action();
  if (ownsTransaction) commit();
}

/** Build the frame-tool node, including the canonical export-region preset. */
export function makeDrawingFrameNode(
  id: string,
  transform: Affine,
  size: { w?: number; h?: number } | undefined,
  exportRegion: boolean,
): SceneNode {
  const node = makeFrameNode(id, {
    name: exportRegion ? 'Export Region' : 'Node',
    frameRole: exportRegion ? 'exportRegion' : 'frame',
    transform,
    fill: exportRegion
      ? { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 }
      : { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    children: [],
    w: size?.w ?? 375,
    h: size?.h ?? 812,
    clipContent: exportRegion ? false : undefined,
  });
  if (!exportRegion) return node;
  return {
    ...node,
    presets: [
      {
        id: `${id}-export-1x`,
        format: 'png' as const,
        scale: { type: 'factor' as const, value: 1 },
        suffix: '',
        enabled: true,
      },
    ],
  } as FrameNode;
}

/** Resolve a selection into the live Boolean document operation, or reject it. */
export function createLiveBooleanForSelection(
  document: Document,
  selection: string[],
  operation: BooleanOpKind,
): ReturnType<typeof createLiveBooleanDoc> | null {
  const operands = selection
    .map((id) => document.nodes[id])
    .filter(
      (node): node is Extract<SceneNode, { kind: 'shape' | 'group' }> =>
        node !== undefined && isBooleanOperand(node),
    );
  if (operands.length < 2 || operands.length !== selection.length) return null;
  return createLiveBooleanDoc(
    document,
    operands.map((operand) => operand.id),
    operation,
  );
}

/** Resolve the default source and apply a mask to the selected target. */
export function addMaskForSelection(
  document: import('@varve/scene').Document,
  id: string,
  selection: string[],
  type: MaskType,
  sourceNodeId?: string,
): import('@varve/scene').Document {
  const container = document.nodes[id];
  if (!container) return document;

  const leafVectorMask = defaultVectorMaskForNode(container, document);
  if (leafVectorMask) return addMask(document, id, undefined, type, { vectorMask: leafVectorMask });

  if (container.kind !== 'adjustment' && !('children' in container)) return document;
  const children = 'children' in container ? container.children : [];
  const maskSource =
    sourceNodeId ??
    (container.kind === 'adjustment'
      ? selection.find((selectedId) => selectedId !== id && document.nodes[selectedId])
      : children.find((childId) => document.nodes[childId] !== undefined));
  if (!maskSource || !document.nodes[maskSource]) return document;
  return addMask(document, id, maskSource, type);
}

/** Commit a knife result atomically and publish its selection/announcement. */
export function applyKnifeCutOutcome(
  outcome: KnifeCutOutcome,
  begin: () => void,
  updateDocument: (
    updater: (document: import('@varve/scene').Document) => import('@varve/scene').Document,
  ) => void,
  commit: () => void,
  applyPatch: (patch: KnifeSelectionPatch) => void,
  announce: (message: string) => void,
): void {
  if (outcome.document) {
    begin();
    updateDocument(() => outcome.document as import('@varve/scene').Document);
    commit();
    outcome.patch && applyPatch(outcome.patch);
  }
  announce(outcome.announcement);
}

export {
  knifeRejectionFor,
  knifeSkipMessage,
  sliceDocumentWithKnife,
  splitPolygonByKnifeLine,
  splitPolylineByKnifeLine,
} from './knifeSlice';

// F4: default shape geometry per tool.
// Research basis: Figma/Illustrator default sizes for shape tools.
export function shapeForTool(tool: ToolId): Shape {
  switch (tool) {
    case 'rect':
      return { kind: 'rect', x: 0, y: 0, w: 100, h: 80 };
    case 'ellipse':
      return { kind: 'ellipse', cx: 50, cy: 40, rx: 50, ry: 40 };
    case 'polygon':
      return { kind: 'polygon', cx: 50, cy: 40, radius: 50, sides: 6, rotation: 0 };
    case 'star':
      return {
        kind: 'star',
        cx: 50,
        cy: 40,
        innerRadius: 20,
        outerRadius: 50,
        points: 5,
        rotation: 0,
      };
    case 'line':
      return { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 3 };
    case 'arrow':
      return { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 3, arrowheadSize: 10 };
    case 'pen':
    case 'pencil':
      return {
        kind: 'path',
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: false,
        tolerance: 3,
      };
    case 'text':
      return { kind: 'rect', x: 0, y: 0, w: 120, h: 32 };
    case 'frame':
    case 'slice':
      return { kind: 'rect', x: 0, y: 0, w: 200, h: 160 };
    case 'knife':
    case 'select':
    case 'hand':
    case 'zoom':
    case 'scale':
    case 'nodeEdit':
    case 'image':
    case 'eyedropper':
    case 'inspect':
    case 'booleanUnion':
    case 'booleanSubtract':
    case 'booleanIntersect':
    case 'booleanExclude':
    case 'cloneStamp':
    case 'healBrush':
    case 'spotHeal':
    case 'patch':
    case 'refineMask':
    case 'trimapEdit':
    case 'crop':
    case 'perspective':
    case 'paint':
    case 'eraser':
    case 'smudge':
    case 'sam2Segment':
    case 'shape':
    case 'connector':
    case 'comment':
    case 'table':
      return { kind: 'rect', x: 0, y: 0, w: 480, h: 240 };
    case 'backgroundRemoval':
    case 'clone':
    case 'contentAwareFill':
    case 'lasso':
    case 'pixelLasso':
    case 'marquee':
    case 'ellipseMarquee':
    case 'warp':
    case 'selectionPaint':
    case 'pixelProbe':
    case 'magicWand':
    case 'floatingTransform':
    case 'selectionBoundary':
    case 'page':
      throw new Error(`shapeForTool called for non-drawing tool: ${tool}`);
    default: {
      const exhaustiveCheck: never = tool;
      throw new Error(`Unknown tool in shapeForTool: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Resize a node to world-space dimensions while preserving its local origin.
 */
export function resizeSceneNode(node: SceneNode, width: number, height: number): SceneNode {
  if (node.kind === 'frame' || node.kind === 'text') return { ...node, w: width, h: height };
  if (node.kind !== 'shape') return node;
  const shape = node.shape;
  switch (shape.kind) {
    case 'rect':
      return { ...node, shape: { ...shape, w: width, h: height } };
    case 'ellipse':
      return {
        ...node,
        shape: { ...shape, rx: width / 2, ry: height / 2, cx: width / 2, cy: height / 2 },
      };
    case 'circle':
      return {
        ...node,
        shape: {
          ...shape,
          r: Math.max(width, height) / 2,
          cx: width / 2,
          cy: height / 2,
        },
      };
    case 'line':
    case 'arrow': {
      const oldWidth = Math.abs(shape.to[0] - shape.from[0]) || 1;
      const oldHeight = Math.abs(shape.to[1] - shape.from[1]) || 1;
      const scaleX = width / oldWidth;
      const scaleY = height / oldHeight;
      const centerX = (shape.from[0] + shape.to[0]) / 2;
      const centerY = (shape.from[1] + shape.to[1]) / 2;
      return {
        ...node,
        shape: {
          ...shape,
          from: [
            centerX + (shape.from[0] - centerX) * scaleX,
            centerY + (shape.from[1] - centerY) * scaleY,
          ],
          to: [
            centerX + (shape.to[0] - centerX) * scaleX,
            centerY + (shape.to[1] - centerY) * scaleY,
          ],
        },
      };
    }
    case 'polygon':
      return { ...node, shape: { ...shape, radius: Math.max(1, width / 2) } };
    case 'star': {
      const oldOuterRadius = shape.outerRadius || 1;
      const outerRadius = Math.max(1, width / 2);
      return {
        ...node,
        shape: {
          ...shape,
          outerRadius,
          innerRadius: Math.max(1, shape.innerRadius * (outerRadius / oldOuterRadius)),
        },
      };
    }
    case 'path': {
      if (shape.points.length === 0) return node;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of shape.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      const scaleX = width / (maxX - minX || 1);
      const scaleY = height / (maxY - minY || 1);
      return {
        ...node,
        shape: {
          ...shape,
          points: shape.points.map((point) => ({
            x: (point.x - minX) * scaleX + minX,
            y: (point.y - minY) * scaleY + minY,
            handleIn: point.handleIn
              ? ([point.handleIn[0] * scaleX, point.handleIn[1] * scaleY] as [number, number])
              : null,
            handleOut: point.handleOut
              ? ([point.handleOut[0] * scaleX, point.handleOut[1] * scaleY] as [number, number])
              : null,
          })),
        },
      };
    }
    default:
      return node;
  }
}

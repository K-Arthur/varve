/**
 * Immutable document operations for derived image and traced-vector output.
 *
 * Research basis: nondestructive image-editing workflows retain the source
 * raster and place derived results beside it as ordinary editable layers.
 */
import { fitBezierToContour } from '@strata/engine';
import type { RasterTracePath } from '@strata/engine';
import {
  addChild,
  type Document,
  getParent,
  imageFill,
  insertNode,
  isImageShape,
  makeGroupNode,
  makeShapeNode,
  moveChild,
  type NodeId,
  nextNodeId,
  type ShapeNode,
} from '@strata/scene';

export function selectedImageShape(doc: Document, selection: NodeId[]): ShapeNode | null {
  for (const id of selection) {
    const node = doc.nodes[id];
    if (node?.kind === 'shape' && isImageShape(node)) return node;
  }
  return null;
}

function insertAfter(
  doc: Document,
  sourceId: NodeId,
  node: ReturnType<typeof makeShapeNode> | ReturnType<typeof makeGroupNode>,
): Document {
  const parentId = getParent(doc, sourceId);
  if (parentId === null) {
    const index = doc.rootChildren.indexOf(sourceId);
    return insertNode(doc, node, index < 0 ? doc.rootChildren.length : index + 1);
  }
  const parent = doc.nodes[parentId];
  if (!parent || (parent.kind !== 'frame' && parent.kind !== 'group')) return doc;
  const sourceIndex = parent.children.indexOf(sourceId);
  const appended = addChild(doc, parentId, node);
  return moveChild(
    appended,
    parentId,
    node.id,
    sourceIndex < 0 ? parent.children.length : sourceIndex + 1,
  );
}

export interface DerivedImageInput {
  dataUrl: string;
  width: number;
  height: number;
  suffix: string;
}

function placeBeside(
  transform: ShapeNode['transform'],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): ShapeNode['transform'] {
  const [a, b, c, d, e, f] = transform;
  const bounds = (width: number, height: number, tx: number, ty: number) => {
    const corners = [
      [tx, ty],
      [a * width + tx, b * width + ty],
      [c * height + tx, d * height + ty],
      [a * width + c * height + tx, b * width + d * height + ty],
    ];
    return {
      minX: Math.min(...corners.map((point) => point[0] as number)),
      minY: Math.min(...corners.map((point) => point[1] as number)),
      maxX: Math.max(...corners.map((point) => point[0] as number)),
    };
  };
  const sourceBounds = bounds(sourceWidth, sourceHeight, e, f);
  const targetBounds = bounds(targetWidth, targetHeight, 0, 0);
  return [
    a,
    b,
    c,
    d,
    sourceBounds.maxX + 4 - targetBounds.minX,
    sourceBounds.minY - targetBounds.minY,
  ];
}

export function insertDerivedImageShape(
  doc: Document,
  sourceId: NodeId,
  input: DerivedImageInput,
): { doc: Document; nodeId: NodeId } {
  const source = doc.nodes[sourceId];
  if (source?.kind !== 'shape' || !isImageShape(source))
    throw new Error('Source must be an image-filled shape');
  const allocated = nextNodeId(doc);
  const sourceWidth = source.shape.kind === 'rect' ? source.shape.w : input.width;
  const sourceHeight = source.shape.kind === 'rect' ? source.shape.h : input.height;
  const derived: ShapeNode = {
    ...source,
    id: allocated.id,
    name: `${source.name} ${input.suffix}`,
    shape: { kind: 'rect', x: 0, y: 0, w: input.width, h: input.height },
    transform: placeBeside(source.transform, sourceWidth, sourceHeight, input.width, input.height),
    fills: [imageFill(input.dataUrl, { fit: 'fill' })],
    backgroundRemoval: undefined,
  };
  return { doc: insertAfter(allocated.doc, sourceId, derived), nodeId: allocated.id };
}

export interface TraceGroupInput {
  width: number;
  height: number;
  paths: Array<Pick<RasterTracePath, 'closed' | 'points' | 'holes' | 'fill'>>;
  /** Retained for diagnostics; compound holes no longer block insert. */
  omittedHoles?: number;
}

export function insertTraceGroup(
  doc: Document,
  sourceId: NodeId,
  input: TraceGroupInput,
): { doc: Document; nodeId: NodeId } {
  const source = doc.nodes[sourceId];
  if (source?.kind !== 'shape' || !isImageShape(source))
    throw new Error('Source must be an image-filled shape');
  const groupAllocation = nextNodeId(doc);
  const sourceWidth = source.shape.kind === 'rect' ? source.shape.w : input.width;
  const sourceHeight = source.shape.kind === 'rect' ? source.shape.h : input.height;
  const group = makeGroupNode(groupAllocation.id, {
    name: `${source.name} trace`,
    transform: placeBeside(source.transform, sourceWidth, sourceHeight, sourceWidth, sourceHeight),
  });
  let result = insertAfter(groupAllocation.doc, sourceId, group);
  const scaleX = sourceWidth / input.width;
  const scaleY = sourceHeight / input.height;
  const scaleAndFit = (points: Array<{ x: number; y: number }>, closed: boolean) => {
    const scaled = points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
    return fitBezierToContour(scaled, closed, { maxError: 0.5, cornerAngle: 135 });
  };

  for (let index = 0; index < input.paths.length; index += 1) {
    const allocation = nextNodeId(result);
    result = allocation.doc;
    const traced = input.paths[index] as Pick<
      RasterTracePath,
      'closed' | 'points' | 'holes' | 'fill'
    >;
    const holes = traced.holes?.map((h) => scaleAndFit(h, true));
    const fillColor = traced.fill ?? { r: 0, g: 0, b: 0, a: 255 };
    const child = makeShapeNode(
      allocation.id,
      {
        kind: 'path',
        closed: traced.closed,
        tolerance: 1,
        points: scaleAndFit(traced.points, traced.closed),
        ...(holes && holes.length > 0 ? { holes, fillRule: 'evenodd' as const } : {}),
      },
      {
        name: `Trace ${index + 1}`,
        fill: {
          space: 'rgb',
          r: fillColor.r,
          g: fillColor.g,
          b: fillColor.b,
          a: fillColor.a,
        },
      },
    );
    result = addChild(result, group.id, child);
  }
  return { doc: result, nodeId: group.id };
}

/**
 * Insert a live trace group at the source's position and hide the source.
 * The source remains in the tree (visible: false) so parameters can be edited
 * and the trace can be cancelled or re-traced.
 */
export function insertLiveTraceGroup(
  doc: Document,
  sourceId: NodeId,
  input: TraceGroupInput,
): { doc: Document; nodeId: NodeId } {
  const source = doc.nodes[sourceId];
  if (source?.kind !== 'shape' || !isImageShape(source))
    throw new Error('Source must be an image-filled shape');

  const groupAllocation = nextNodeId(doc);
  const sourceWidth = source.shape.kind === 'rect' ? source.shape.w : input.width;
  const sourceHeight = source.shape.kind === 'rect' ? source.shape.h : input.height;
  const group = makeGroupNode(groupAllocation.id, {
    name: `${source.name} trace`,
    transform: source.transform,
    locked: true,
    visible: true,
  });
  let result = insertAfter(groupAllocation.doc, sourceId, group);

  const scaleX = sourceWidth / input.width;
  const scaleY = sourceHeight / input.height;
  const scaleAndFit = (points: Array<{ x: number; y: number }>, closed: boolean) => {
    const scaled = points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
    return fitBezierToContour(scaled, closed, { maxError: 0.5, cornerAngle: 135 });
  };

  for (let index = 0; index < input.paths.length; index += 1) {
    const allocation = nextNodeId(result);
    result = allocation.doc;
    const traced = input.paths[index] as Pick<
      RasterTracePath,
      'closed' | 'points' | 'holes' | 'fill'
    >;
    const holes = traced.holes?.map((h) => scaleAndFit(h, true));
    const fillColor = traced.fill ?? { r: 0, g: 0, b: 0, a: 255 };
    const child = makeShapeNode(
      allocation.id,
      {
        kind: 'path',
        closed: traced.closed,
        tolerance: 1,
        points: scaleAndFit(traced.points, traced.closed),
        ...(holes && holes.length > 0 ? { holes, fillRule: 'evenodd' as const } : {}),
      },
      {
        name: `Trace ${index + 1}`,
        fill: {
          space: 'rgb',
          r: fillColor.r,
          g: fillColor.g,
          b: fillColor.b,
          a: fillColor.a,
        },
      },
    );
    result = addChild(result, group.id, child);
  }

  const hiddenSource = { ...source, visible: false };
  result = { ...result, nodes: { ...result.nodes, [sourceId]: hiddenSource } };

  return { doc: result, nodeId: group.id };
}

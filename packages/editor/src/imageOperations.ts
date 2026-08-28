/**
 * Immutable document operations for derived image and traced-vector output.
 *
 * Research basis: nondestructive image-editing workflows retain the source
 * raster and place derived results beside it as ordinary editable layers.
 */

import type { RasterTracePath } from '@varve/engine';
import { fitBezierToContour } from '@varve/engine';
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
  moveNode,
  type NodeId,
  nextNodeId,
  removeNode,
  type ShapeNode,
  type TraceMetadata,
} from '@varve/scene';

export function selectedImageShape(doc: Document, selection: NodeId[]): ShapeNode | null {
  for (const id of selection) {
    const node = doc.nodes[id];
    if (node?.kind === 'shape' && isImageShape(node)) return node;
  }
  return null;
}

/** All image shapes in the current selection, in selection order. */
export function selectedImageShapes(doc: Document, selection: NodeId[]): ShapeNode[] {
  const shapes: ShapeNode[] = [];
  for (const id of selection) {
    const node = doc.nodes[id];
    if (node?.kind === 'shape' && isImageShape(node)) shapes.push(node);
  }
  return shapes;
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
  /**
   * Set when the caller has already composited the source's cutout into
   * `dataUrl`, so the mask must not travel to the derived node and be applied
   * a second time.
   *
   * Most derived outputs (denoise, colorize, line art, lens blur) keep the
   * source's dimensions and do not bake, so they inherit the mask and it still
   * lines up. Upscaling is the exception on both counts: it bakes, and its
   * output is larger, so an inherited mask would composite misaligned and
   * uncover the removed background across part of the image.
   */
  maskBakedIn?: boolean;
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
    ...(input.maskBakedIn ? { mask: undefined } : {}),
  };
  return { doc: insertAfter(allocated.doc, sourceId, derived), nodeId: allocated.id };
}

export interface TraceGroupInput {
  width: number;
  height: number;
  paths: Array<
    Pick<RasterTracePath, 'closed' | 'points' | 'holes' | 'fill' | 'strokeWidth' | 'curveFitted'>
  >;
  /** Retained for diagnostics; compound holes no longer block insert. */
  omittedHoles?: number;
  /** Bezier corner angle threshold (degrees). Default 135. */
  cornerAngle?: number;
  /** Bezier max fitting error (pixels). Default 1.0. */
  maxError?: number;
  /** Whether to trace as centerline (stroked) vs silhouette (filled). */
  traceMode?: 'silhouette' | 'centerline';
  /** Target stroke width for centerline mode. Default 2. */
  centerlineWidth?: number;
  /** Versioned provenance stored on the group (enables Edit Trace). */
  metadata?: TraceMetadata;
}

function scaleCurveFittedPoints(
  points: RasterTracePath['points'],
  scaleX: number,
  scaleY: number,
): ReturnType<typeof fitBezierToContour> {
  return points.map((point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
    handleIn: point.handleIn
      ? ([point.handleIn[0] * scaleX, point.handleIn[1] * scaleY] as [number, number])
      : null,
    handleOut: point.handleOut
      ? ([point.handleOut[0] * scaleX, point.handleOut[1] * scaleY] as [number, number])
      : null,
  }));
}

/** Build one traced path node: filled for closed contours, stroked for
 *  centerline (open) contours. Hole rings only apply to closed fills. */
function makeTraceChildNode(
  id: NodeId,
  traced: TraceGroupInput['paths'][number],
  index: number,
  scaleAndFit: (
    points: RasterTracePath['points'],
    closed: boolean,
    curveFitted: boolean | undefined,
  ) => ReturnType<typeof fitBezierToContour>,
  strokeWeight: number,
): ReturnType<typeof makeShapeNode> {
  const holes = traced.holes?.map((h) => scaleAndFit(h, true, traced.curveFitted));
  const fillColor = traced.fill ?? { r: 0, g: 0, b: 0, a: 255 };
  if (!traced.closed) {
    // Centerline output: an open stroked path (no fill).
    return makeShapeNode(
      id,
      {
        kind: 'path',
        closed: false,
        tolerance: 1,
        points: scaleAndFit(traced.points, false, traced.curveFitted),
      },
      {
        name: `Trace ${index + 1}`,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
            weight: traced.strokeWidth ?? strokeWeight,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
      },
    );
  }
  return makeShapeNode(
    id,
    {
      kind: 'path',
      closed: true,
      tolerance: 1,
      points: scaleAndFit(traced.points, true, traced.curveFitted),
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
  if (input.metadata) {
    result = {
      ...result,
      nodes: {
        ...result.nodes,
        [group.id]: { ...(result.nodes[group.id] as typeof group), traceMetadata: input.metadata },
      },
    };
  }
  const scaleX = sourceWidth / input.width;
  const scaleY = sourceHeight / input.height;
  const bezierAngle = input.cornerAngle ?? 135;
  const bezierError = input.maxError ?? 1.0;
  const scaleAndFit = (
    points: RasterTracePath['points'],
    closed: boolean,
    curveFitted: boolean | undefined,
  ) => {
    if (curveFitted) return scaleCurveFittedPoints(points, scaleX, scaleY);
    const scaled = points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
    return fitBezierToContour(scaled, closed, { maxError: bezierError, cornerAngle: bezierAngle });
  };

  for (let index = 0; index < input.paths.length; index += 1) {
    const allocation = nextNodeId(result);
    result = allocation.doc;
    const traced = input.paths[index] as TraceGroupInput['paths'][number];
    const child = makeTraceChildNode(
      allocation.id,
      traced,
      index,
      scaleAndFit,
      input.centerlineWidth ?? 2,
    );
    result = addChild(result, group.id, child);
  }
  return { doc: result, nodeId: group.id };
}

/**
 * Re-trace in place: remove the previous trace group and insert a new one at
 * the same paint order position. Falls back to beside-the-source placement
 * when the old group's slot can no longer be resolved. One undo entry.
 */
export function replaceTraceGroup(
  doc: Document,
  sourceId: NodeId,
  replaceGroupId: NodeId,
  input: TraceGroupInput,
): { doc: Document; nodeId: NodeId } {
  const oldParentId = getParent(doc, replaceGroupId);
  const oldParent = oldParentId !== null ? doc.nodes[oldParentId] : undefined;
  const oldIndex =
    oldParentId === null
      ? doc.rootChildren.indexOf(replaceGroupId)
      : oldParent && (oldParent.kind === 'group' || oldParent.kind === 'frame')
        ? oldParent.children.indexOf(replaceGroupId)
        : -1;
  const removed = removeNode(doc, replaceGroupId);
  const inserted = insertTraceGroup(removed, sourceId, input);
  let result = inserted.doc;
  const newParentId = getParent(result, inserted.nodeId);
  if (oldIndex >= 0) {
    if (newParentId === null && oldParentId === null) {
      result = moveNode(result, inserted.nodeId, oldIndex);
    } else if (newParentId !== null && newParentId === oldParentId) {
      result = moveChild(result, oldParentId, inserted.nodeId, oldIndex);
    }
  }
  return { doc: result, nodeId: inserted.nodeId };
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
  const bezierAngle2 = input.cornerAngle ?? 135;
  const bezierError2 = input.maxError ?? 1.0;
  const scaleAndFit = (
    points: RasterTracePath['points'],
    closed: boolean,
    curveFitted: boolean | undefined,
  ) => {
    if (curveFitted) return scaleCurveFittedPoints(points, scaleX, scaleY);
    const scaled = points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
    return fitBezierToContour(scaled, closed, {
      maxError: bezierError2,
      cornerAngle: bezierAngle2,
    });
  };

  for (let index = 0; index < input.paths.length; index += 1) {
    const allocation = nextNodeId(result);
    result = allocation.doc;
    const traced = input.paths[index] as TraceGroupInput['paths'][number];
    const child = makeTraceChildNode(
      allocation.id,
      traced,
      index,
      scaleAndFit,
      input.centerlineWidth ?? 2,
    );
    result = addChild(result, group.id, child);
  }

  const hiddenSource = { ...source, visible: false };
  result = { ...result, nodes: { ...result.nodes, [sourceId]: hiddenSource } };

  return { doc: result, nodeId: group.id };
}

/**
 * Bake a background-removal alpha mask into an image's pixels.
 *
 * Masks are stored beside the image (a RasterMaskAsset, or the legacy
 * `backgroundRemoval.maskDataUrl`) and composited at render time, so the fill's
 * own pixels are still the untouched original. Any operation that reads those
 * pixels and writes a new layer — upscaling, in particular — would otherwise
 * resurrect the removed background, because the derived node does not carry the
 * source's mask forward.
 *
 * The mask is drawn scaled to the image's dimensions (mask and image resolution
 * need not match) and multiplied into the existing alpha rather than replacing
 * it, so pre-existing transparency survives.
 */
export async function bakeAlphaMaskIntoImageData(
  source: ImageData,
  maskDataUrl: string,
): Promise<ImageData> {
  const { getImageCache } = await import('@varve/engine');
  const maskImage = await getImageCache().load(maskDataUrl);

  const maskCanvas = globalThis.document.createElement('canvas');
  maskCanvas.width = source.width;
  maskCanvas.height = source.height;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return source;
  maskCtx.drawImage(maskImage, 0, 0, source.width, source.height);
  const mask = maskCtx.getImageData(0, 0, source.width, source.height);

  const out = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  for (let i = 0; i < source.width * source.height; i += 1) {
    // Masks are written as opaque greyscale, so the red channel carries the
    // coverage value; fall back to the mask's own alpha when it is not opaque.
    const maskAlpha = mask.data[i * 4 + 3] as number;
    const coverage = maskAlpha === 255 ? (mask.data[i * 4] as number) : maskAlpha;
    out.data[i * 4 + 3] = Math.round(((out.data[i * 4 + 3] as number) * coverage) / 255);
  }
  return out;
}

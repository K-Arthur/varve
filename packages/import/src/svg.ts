/**
 * SVG parser — converts SVG XML into a Strata Document using a string-based
 * recursive descent approach (no DOMParser dependency).
 *
 * Research basis: SVG 1.1 (W3C Recommendation), Adobe Illustrator SVG export.
 */
import type { Affine, PathPoint, Shape } from '@strata/engine';
import type { Document, FrameNode, ManagedColor, SceneNode } from '@strata/scene';
import {
  addMask,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@strata/scene';
import type { ImportOptions, ImportParser, ImportResult } from './types';

interface ParsedElement {
  tag: string;
  attrs: Record<string, string>;
  children: ParsedElement[];
  textContent: string;
}

export function parseSvg(svg: string, options?: Partial<ImportOptions>): ImportResult {
  const opts: ImportOptions = {
    embedImages: options?.embedImages ?? true,
    scale: options?.scale ?? 1,
    center: options?.center ?? false,
    keepPosition: options?.keepPosition ?? false,
  };

  const clean = svg.trim();
  const root = parseSingleElement(clean);
  if (root?.tag !== 'svg') {
    return {
      document: createDocument('Import'),
      nodeIds: [],
      warnings: ['No <svg> element found'],
    };
  }

  const warnings: string[] = [];
  let doc = createDocument('Imported SVG');
  const nodeIds: string[] = [];

  const vb = root.attrs.viewBox;
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      const [, , vw, vh] = parts;
      doc = { ...doc, canvasWidth: vw, canvasHeight: vh };
    }
  }

  if (root.attrs.width && root.attrs.height) {
    const w = parseUnit(root.attrs.width);
    const h = parseUnit(root.attrs.height);
    if (w && h) {
      doc = { ...doc, canvasWidth: w, canvasHeight: h };
    }
  }

  const defs = collectDefs(root);

  for (const child of root.children) {
    const { doc: d, ids } = convertElement(child, doc, defs, [], opts, warnings);
    doc = d;
    nodeIds.push(...ids);
  }

  return { document: doc, nodeIds, warnings };
}

function collectDefs(el: ParsedElement): Map<string, ParsedElement> {
  const defs = new Map<string, ParsedElement>();
  function walk(e: ParsedElement): void {
    if (e.tag === 'defs') {
      for (const child of e.children) {
        const id = child.attrs.id ?? child.attrs['xml:id'];
        if (id) defs.set(id, child);
      }
    }
    for (const child of e.children) walk(child);
  }
  walk(el);
  return defs;
}

function convertElement(
  el: ParsedElement,
  doc: Document,
  defs: Map<string, ParsedElement>,
  inheritedTransform: string[],
  opts: ImportOptions,
  warnings: string[],
  visitedIds = new Set<string>(),
): { doc: Document; ids: string[] } {
  const ids: string[] = [];

  if (el.tag === 'defs') return { doc, ids };

  if (el.tag === 'svg') {
    for (const child of el.children) {
      const r = convertElement(child, doc, defs, inheritedTransform, opts, warnings, visitedIds);
      doc = r.doc;
      ids.push(...r.ids);
    }
    return { doc, ids };
  }

  const transformAttr = el.attrs.transform;
  const transforms = transformAttr ? [...inheritedTransform, transformAttr] : inheritedTransform;

  if (el.tag === 'g') {
    let gDoc = doc;
    const gIds: string[] = [];
    for (const child of el.children) {
      const r = convertElement(child, gDoc, defs, transforms, opts, warnings, visitedIds);
      gDoc = r.doc;
      gIds.push(...r.ids);
    }
    if (gIds.length > 0) {
      const { id, doc: gDocWithId } = nextNodeId(gDoc);
      gDoc = gDocWithId;
      const groupTransformAffine = composeTransforms(transforms);
      const { x, y, w, h } = computeGroupBounds(gDoc, gIds);
      const groupNode: FrameNode = {
        ...makeFrameNode(id, {
          name: 'Group',
          children: gIds,
          w,
          h,
        }),
        transform: [
          groupTransformAffine[0],
          groupTransformAffine[1],
          groupTransformAffine[2],
          groupTransformAffine[3],
          groupTransformAffine[4] + x,
          groupTransformAffine[5] + y,
        ] as Affine,
      };
      for (const childId of gIds) {
        adjustNodePosition(gDoc, childId, -x, -y);
      }
      gDoc = { ...gDoc, nodes: { ...gDoc.nodes, [id]: groupNode as SceneNode } };
      gDoc = {
        ...gDoc,
        rootChildren: [...gDoc.rootChildren.filter((nid) => !gIds.includes(nid)), id],
      };
      // Apply clip-path or mask if present on the group
      gDoc = applyGroupClipOrMask(gDoc, id, el, defs, transforms, opts, warnings);
      ids.push(id);
      return { doc: gDoc, ids };
    }
    return { doc: gDoc, ids: gIds };
  }

  if (el.tag === 'use') {
    const href = el.attrs.href ?? el.attrs['xlink:href'];
    if (href?.startsWith('#')) {
      const refId = href.slice(1);
      const ref = defs.get(refId);
      if (ref) {
        if (visitedIds.has(refId)) {
          warnings.push(`Circular <use> reference detected for #${refId} — skipping`);
          return { doc, ids };
        }
        visitedIds.add(refId);
        const x = parseFloat(el.attrs.x ?? '0');
        const y = parseFloat(el.attrs.y ?? '0');
        const useTransform = `translate(${x},${y})`;
        const r = convertElement(
          ref,
          doc,
          defs,
          [...transforms, useTransform],
          opts,
          warnings,
          visitedIds,
        );
        visitedIds.delete(refId);
        return { doc: r.doc, ids: r.ids };
      }
    }
    warnings.push(`<use> references unknown id: ${href}`);
    return { doc, ids };
  }

  let result: { node: SceneNode; warnings: string[] } | null = null;

  switch (el.tag) {
    case 'rect':
      result = convertRect(el, transforms, opts);
      break;
    case 'circle':
      result = convertCircle(el, transforms, opts);
      break;
    case 'ellipse':
      result = convertEllipse(el, transforms, opts);
      break;
    case 'line':
      result = convertLine(el, transforms, opts);
      break;
    case 'polygon':
      result = convertPolygon(el, transforms, opts);
      break;
    case 'polyline':
      result = convertPolyline(el, transforms, opts);
      break;
    case 'path':
      result = convertPath(el, transforms, opts);
      break;
    case 'text':
      result = convertText(el, transforms, opts);
      break;
    case 'image':
      result = convertImage(el, transforms, opts);
      break;
    default:
      break;
  }

  if (result) {
    const { id, doc: d2 } = nextNodeId(doc);
    const styled = applyStylesToNode(result.node, el);
    const node = { ...styled, id } as SceneNode;
    doc = addNode(d2, node);
    ids.push(id);

    // If the leaf element has clip-path or mask, wrap in a group and apply
    const clipRef = parseUrlReference(el.attrs['clip-path'] ?? '');
    const maskRef = parseUrlReference(el.attrs.mask ?? '');
    if (clipRef || maskRef) {
      const wrapped = wrapNodeInMaskedGroup(doc, id, el, defs, transforms, opts, warnings);
      if (wrapped) {
        doc = wrapped.doc;
        ids.length = 0;
        ids.push(wrapped.groupId);
      }
    }
  }

  return { doc, ids };
}

function convertRect(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const x = parseFloat(el.attrs.x ?? '0') * opts.scale;
  const y = parseFloat(el.attrs.y ?? '0') * opts.scale;
  const w = parseFloat(el.attrs.width ?? '0') * opts.scale;
  const h = parseFloat(el.attrs.height ?? '0') * opts.scale;
  const rx = parseFloat(el.attrs.rx ?? '0') * opts.scale;
  const ry = parseFloat(el.attrs.ry ?? '0') * opts.scale;

  const shape: Shape = { kind: 'rect', x: 0, y: 0, w, h };
  const transform = composeTransforms(transforms);
  const cornerRadius = rx > 0 || ry > 0 ? (Math.max(rx, ry) as number) : undefined;

  const node = makeShapeNode('', shape, {
    name: 'Rectangle',
    transform: composeWithOffset(transform, x, y),
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    cornerRadius: cornerRadius
      ? [cornerRadius, cornerRadius, cornerRadius, cornerRadius]
      : undefined,
  });
  return { node, warnings: [] };
}

function convertCircle(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const cx = parseFloat(el.attrs.cx ?? '0') * opts.scale;
  const cy = parseFloat(el.attrs.cy ?? '0') * opts.scale;
  const r = parseFloat(el.attrs.r ?? '0') * opts.scale;

  const shape: Shape = { kind: 'circle', cx: 0, cy: 0, r };
  const transform = composeTransforms(transforms);

  const node = makeShapeNode('', shape, {
    name: 'Circle',
    transform: composeWithOffset(transform, cx, cy),
  });
  return { node, warnings: [] };
}

function convertEllipse(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const cx = parseFloat(el.attrs.cx ?? '0') * opts.scale;
  const cy = parseFloat(el.attrs.cy ?? '0') * opts.scale;
  const rx = parseFloat(el.attrs.rx ?? '0') * opts.scale;
  const ry = parseFloat(el.attrs.ry ?? '0') * opts.scale;

  const shape: Shape = { kind: 'ellipse', cx: 0, cy: 0, rx, ry };
  const transform = composeTransforms(transforms);

  const node = makeShapeNode('', shape, {
    name: 'Ellipse',
    transform: composeWithOffset(transform, cx, cy),
  });
  return { node, warnings: [] };
}

function convertLine(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const x1 = parseFloat(el.attrs.x1 ?? '0') * opts.scale;
  const y1 = parseFloat(el.attrs.y1 ?? '0') * opts.scale;
  const x2 = parseFloat(el.attrs.x2 ?? '0') * opts.scale;
  const y2 = parseFloat(el.attrs.y2 ?? '0') * opts.scale;

  const shape: Shape = { kind: 'line', from: [0, 0], to: [x2 - x1, y2 - y1], tolerance: 3 };
  const transform = composeTransforms(transforms);

  const node = makeShapeNode('', shape, {
    name: 'Line',
    transform: composeWithOffset(transform, x1, y1),
  });
  return { node, warnings: [] };
}

function convertPolygon(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const pointsStr = el.attrs.points ?? '';
  const points = parsePoints(pointsStr, opts.scale);

  if (points.length === 0) {
    const node = makeShapeNode('', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Polygon' });
    return { node, warnings: ['Empty polygon'] };
  }

  const { cx, cy, radius, sides } = fitPolygon(points);
  const shape: Shape = {
    kind: 'polygon',
    cx: 0,
    cy: 0,
    radius,
    sides: Math.max(3, sides),
    rotation: 0,
  };
  const transform = composeTransforms(transforms);

  const node = makeShapeNode('', shape, {
    name: 'Polygon',
    transform: composeWithOffset(transform, cx, cy),
  });
  return { node, warnings: [] };
}

function convertPolyline(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const pointsStr = el.attrs.points ?? '';
  const pts = parsePoints(pointsStr, opts.scale);

  if (pts.length === 0) {
    const node = makeShapeNode('', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Path' });
    return { node, warnings: ['Empty polyline'] };
  }

  const pathPoints: PathPoint[] = pts.map((p) => ({
    x: p.x,
    y: p.y,
    handleIn: null,
    handleOut: null,
  }));

  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const localPoints = pathPoints.map((p) => ({
    ...p,
    x: p.x - minX,
    y: p.y - minY,
  }));

  const shape: Shape = { kind: 'path', points: localPoints, closed: false, tolerance: 3 };
  const transform = composeTransforms(transforms);

  const node = makeShapeNode('', shape, {
    name: 'Path',
    transform: composeWithOffset(transform, minX, minY),
  });
  return { node, warnings: [] };
}

function convertPath(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const d = el.attrs.d ?? '';
  const parsed = parsePathData(d, opts.scale);

  if (parsed.points.length < 2) {
    const node = makeShapeNode('', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Path' });
    return { node, warnings: ['Path too short'] };
  }

  const shape: Shape = { kind: 'path', points: parsed.points, closed: parsed.closed, tolerance: 3 };
  const transform = composeTransforms(transforms);

  const node = makeShapeNode('', shape, {
    name: 'Path',
    transform,
  });
  return { node, warnings: [] };
}

function convertText(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const x = parseFloat(el.attrs.x ?? '0') * opts.scale;
  const y = parseFloat(el.attrs.y ?? '0') * opts.scale;
  const fontSize = parseFloat(el.attrs['font-size'] ?? '16') * opts.scale;
  const fontFamily = el.attrs['font-family'] ?? 'sans-serif';
  const fontWeight = parseInt(el.attrs['font-weight'] ?? '400', 10);
  const textAlign =
    el.attrs['text-anchor'] === 'middle'
      ? 'center'
      : el.attrs['text-anchor'] === 'end'
        ? 'right'
        : 'left';
  const text = el.textContent || '';

  const transform = composeTransforms(transforms);

  const node = makeTextNode('', text, {
    name: 'Text',
    transform: composeWithOffset(transform, x, y),
    fontSize,
    fontFamily,
    fontWeight,
    textAlign: textAlign as 'left' | 'center' | 'right',
  });
  return { node, warnings: [] };
}

function convertImage(
  el: ParsedElement,
  transforms: string[],
  opts: ImportOptions,
): { node: SceneNode; warnings: string[] } {
  const x = parseFloat(el.attrs.x ?? '0') * opts.scale;
  const y = parseFloat(el.attrs.y ?? '0') * opts.scale;
  const w = parseFloat(el.attrs.width ?? '100') * opts.scale;
  const h = parseFloat(el.attrs.height ?? '100') * opts.scale;
  const href = el.attrs.href ?? el.attrs['xlink:href'] ?? '';
  const transform = composeTransforms(transforms);

  const node: SceneNode = {
    ...makeShapeNode(
      '',
      { kind: 'rect', x: 0, y: 0, w, h },
      {
        name: 'Image',
        transform: composeWithOffset(transform, x, y),
        fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
      },
    ),
    fills: [
      {
        type: 'image',
        image: { src: href, fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
  };
  return { node, warnings: [] };
}

function applyStylesToNode(node: SceneNode, el: ParsedElement): SceneNode {
  let fill = el.attrs.fill ?? el.attrs.style;
  let stroke = el.attrs.stroke;
  let strokeWidth = el.attrs['stroke-width'];
  let opacity = el.attrs.opacity;
  let fillOpacity = el.attrs['fill-opacity'];
  let strokeOpacity = el.attrs['stroke-opacity'];

  // Parse inline style attribute
  if (el.attrs.style) {
    const styles = parseCssStyle(el.attrs.style);
    fill = styles.fill ?? fill;
    stroke = styles.stroke ?? stroke;
    strokeWidth = styles['stroke-width'] ?? strokeWidth;
    opacity = styles.opacity ?? opacity;
    fillOpacity = styles['fill-opacity'] ?? fillOpacity;
    strokeOpacity = styles['stroke-opacity'] ?? strokeOpacity;
  }

  let result = { ...node };

  if (fill && fill !== 'none') {
    const parsedColor = parseSvgColor(fill);
    if (parsedColor) {
      result = { ...result, fill: parsedColor };
    }
  } else if (fill === 'none') {
    result = { ...result, fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 } };
  }

  if (opacity) {
    const op = parseFloat(opacity);
    if (!Number.isNaN(op)) {
      result = { ...result, opacity: op };
    }
  }

  if (fillOpacity) {
    const fop = parseFloat(fillOpacity);
    if (!Number.isNaN(fop) && 'fills' in result && result.fills && result.fills.length > 0) {
      const fills = [...result.fills];
      fills[0] = { ...fills[0]!, opacity: fop };
      result = { ...result, fills } as SceneNode;
    }
  }

  if (stroke && stroke !== 'none') {
    const parsedStrokeColor = parseSvgColor(stroke);
    const sw = strokeWidth ? parseFloat(strokeWidth) : 1;
    const strokeOpacityVal = strokeOpacity ? parseFloat(strokeOpacity) : 1;
    if (parsedStrokeColor && parsedStrokeColor.space === 'rgb') {
      const strokeColor: ManagedColor = {
        space: 'rgb' as const,
        r: parsedStrokeColor.r,
        g: parsedStrokeColor.g,
        b: parsedStrokeColor.b,
        a: Math.round((parsedStrokeColor.a ?? 255) * strokeOpacityVal),
      };
      result = {
        ...result,
        strokes: [
          {
            color: strokeColor,
            weight: sw,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'miter',
            miterLimit: 4,
            visible: true,
          },
        ],
      } as SceneNode;
    }
  }

  return result;
}

// ─── SVG clipPath / mask handling ──────────────────────────────────────────

/**
 * Parse a `url(#id)` reference from a clip-path or mask attribute.
 * Returns the referenced ID or null if the format is invalid.
 */
function parseUrlReference(value: string): string | null {
  const match = value.trim().match(/^url\(#([^)]+)\)$/);
  return match ? match[1]! : null;
}

/**
 * Determine the mask type from a <mask> element's mask-type attribute.
 * SVG default is alpha; `mask-type="luminance"` selects luminance.
 */
function maskTypeFromElement(el: ParsedElement): 'alpha' | 'luminance' {
  const maskType = el.attrs['mask-type'];
  if (maskType === 'luminance') return 'luminance';
  return 'alpha';
}

/**
 * Convert the children of a <clipPath> or <mask> element into a single
 * mask source node. Multiple children are wrapped in a group.
 */
function buildMaskSourceNode(
  defEl: ParsedElement,
  doc: Document,
  defs: Map<string, ParsedElement>,
  transforms: string[],
  opts: ImportOptions,
  warnings: string[],
): { doc: Document; sourceId: string | null } {
  const childNodes: string[] = [];
  let d = doc;

  for (const child of defEl.children) {
    const r = convertElement(child, d, defs, transforms, opts, warnings);
    d = r.doc;
    childNodes.push(...r.ids);
  }

  if (childNodes.length === 0) {
    return { doc: d, sourceId: null };
  }

  // Remove created nodes from rootChildren — they will be children of the
  // masked container, not root-level nodes.
  d = {
    ...d,
    rootChildren: d.rootChildren.filter((nid) => !childNodes.includes(nid)),
  };

  if (childNodes.length === 1) {
    return { doc: d, sourceId: childNodes[0]! };
  }

  // Multiple children: wrap in a group
  const { id, doc: d2 } = nextNodeId(d);
  d = d2;
  const { x, y, w, h } = computeGroupBounds(d, childNodes);
  const groupNode: FrameNode = {
    ...makeFrameNode(id, {
      name: 'Mask Source',
      children: childNodes,
      w,
      h,
    }),
    transform: [1, 0, 0, 1, x, y] as Affine,
  };
  for (const childId of childNodes) {
    adjustNodePosition(d, childId, -x, -y);
  }
  d = { ...d, nodes: { ...d.nodes, [id]: groupNode as SceneNode } };
  return { doc: d, sourceId: id };
}

/**
 * Apply an SVG clip-path or mask reference to a container node.
 * Creates the mask source from the def, adds it as a child, and sets the mask.
 */
function applySvgClipOrMask(
  doc: Document,
  containerId: string,
  defEl: ParsedElement,
  maskType: 'clip' | 'alpha' | 'luminance',
  opts: ImportOptions,
  defs: Map<string, ParsedElement>,
  transforms: string[],
  warnings: string[],
): Document {
  const { doc: d2, sourceId } = buildMaskSourceNode(defEl, doc, defs, transforms, opts, warnings);
  if (!sourceId) {
    warnings.push('clipPath/mask definition is empty — skipping');
    return d2;
  }

  // Ensure the source is a child of the container
  const container = d2.nodes[containerId];
  if (!container) return d2;
  const children = 'children' in container ? container.children : undefined;
  let d = d2;
  if (children && !children.includes(sourceId)) {
    // Add source as first child (mask sources should be first in Strata)
    d = {
      ...d,
      nodes: {
        ...d.nodes,
        [containerId]: { ...container, children: [sourceId, ...children] } as SceneNode,
      },
    };
  }

  d = addMask(d, containerId, sourceId, maskType, {
    fillRule: defEl.attrs['clip-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
  });

  return d;
}

/**
 * Apply clip-path or mask attributes from an SVG element to a Strata group.
 * Looks up the referenced def and creates the mask source node.
 */
function applyGroupClipOrMask(
  doc: Document,
  groupId: string,
  el: ParsedElement,
  defs: Map<string, ParsedElement>,
  transforms: string[],
  opts: ImportOptions,
  warnings: string[],
): Document {
  let d = doc;

  // Handle clip-path
  const clipRef = parseUrlReference(el.attrs['clip-path'] ?? '');
  if (clipRef) {
    const clipDef = defs.get(clipRef);
    if (clipDef) {
      d = applySvgClipOrMask(d, groupId, clipDef, 'clip', opts, defs, transforms, warnings);
    } else {
      warnings.push(`clip-path references unknown id: #${clipRef}`);
    }
  }

  // Handle mask
  const maskRef = parseUrlReference(el.attrs.mask ?? '');
  if (maskRef) {
    const maskDef = defs.get(maskRef);
    if (maskDef) {
      const maskType = maskTypeFromElement(maskDef);
      d = applySvgClipOrMask(d, groupId, maskDef, maskType, opts, defs, transforms, warnings);
    } else {
      warnings.push(`mask references unknown id: #${maskRef}`);
    }
  }

  return d;
}

/**
 * Wrap a single node in a group so a clip-path or mask can be applied.
 * Returns the group node ID and updated document, or null if no mask was applied.
 */
function wrapNodeInMaskedGroup(
  doc: Document,
  nodeId: string,
  el: ParsedElement,
  defs: Map<string, ParsedElement>,
  transforms: string[],
  opts: ImportOptions,
  warnings: string[],
): { doc: Document; groupId: string } | null {
  const clipRef = parseUrlReference(el.attrs['clip-path'] ?? '');
  const maskRef = parseUrlReference(el.attrs.mask ?? '');
  if (!clipRef && !maskRef) return null;

  const { id: groupId, doc: d0 } = nextNodeId(doc);
  let d = d0;
  const node = d.nodes[nodeId];
  if (!node) return null;
  const bounds = nodeBounds(node);
  const groupNode: FrameNode = {
    ...makeFrameNode(groupId, {
      name: 'Masked Group',
      children: [nodeId],
      w: bounds.w,
      h: bounds.h,
    }),
    transform: [1, 0, 0, 1, bounds.x, bounds.y] as Affine,
  };
  d = { ...d, nodes: { ...d.nodes, [groupId]: groupNode as SceneNode } };
  d = {
    ...d,
    rootChildren: [...d.rootChildren.filter((nid) => nid !== nodeId), groupId],
  };
  d = applyGroupClipOrMask(d, groupId, el, defs, transforms, opts, warnings);
  return { doc: d, groupId };
}

/**
 * Compute the world-space bounds of a single node based on its transform
 * and intrinsic dimensions. Used to size wrapper groups for masked leaves.
 */
function nodeBounds(node: SceneNode): { x: number; y: number; w: number; h: number } {
  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;
  let bw = 0;
  let bh = 0;
  if (node.kind === 'shape') {
    const s = node.shape;
    if (s.kind === 'rect') {
      bw = s.w;
      bh = s.h;
    } else if (s.kind === 'circle') {
      bw = s.r * 2;
      bh = s.r * 2;
    } else if (s.kind === 'ellipse') {
      bw = s.rx * 2;
      bh = s.ry * 2;
    } else if (s.kind === 'polygon') {
      bw = s.radius * 2;
      bh = s.radius * 2;
    } else if (s.kind === 'star') {
      bw = s.outerRadius * 2;
      bh = s.outerRadius * 2;
    } else if (s.kind === 'line' || s.kind === 'arrow') {
      bw = Math.abs(s.to[0] - s.from[0]) || 4;
      bh = Math.abs(s.to[1] - s.from[1]) || 4;
    }
  } else if (node.kind === 'text') {
    bw = (node.fontSize ?? 16) * 6;
    bh = (node.fontSize ?? 16) * 1.4;
  } else if (node.kind === 'frame') {
    bw = node.w;
    bh = node.h;
  } else if (node.kind === 'group') {
    bw = 0;
    bh = 0;
  }
  return { x: tx, y: ty, w: bw, h: bh };
}

// ─── SVG path data parser ──────────────────────────────────────────────────

interface PathParseResult {
  points: PathPoint[];
  closed: boolean;
}

function parsePathData(d: string, scale: number): PathParseResult {
  const commands = tokenizePath(d);
  const points: PathPoint[] = [];
  let closed = false;
  let cx = 0,
    cy = 0;
  let prevControl: { x: number; y: number } | null = null;

  for (const cmd of commands) {
    const c = cmd.command;
    const p = cmd.params;

    if (c === 'M' && p.length >= 2) {
      cx = p[0]! * scale;
      cy = p[1]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'm' && p.length >= 2) {
      cx += p[0]! * scale;
      cy += p[1]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'L' && p.length >= 2) {
      cx = p[0]! * scale;
      cy = p[1]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'l' && p.length >= 2) {
      cx += p[0]! * scale;
      cy += p[1]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'H' && p.length >= 1) {
      cx = p[0]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'h' && p.length >= 1) {
      cx += p[0]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'V' && p.length >= 1) {
      cy = p[0]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'v' && p.length >= 1) {
      cy += p[0]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'C' && p.length >= 6) {
      const cx1 = p[0]! * scale,
        cy1 = p[1]! * scale;
      const cx2 = p[2]! * scale,
        cy2 = p[3]! * scale;
      cx = p[4]! * scale;
      cy = p[5]! * scale;
      const last = points[points.length - 1];
      if (last) {
        last.handleOut = [cx1 - last.x, cy1 - last.y];
      }
      points.push({ x: cx, y: cy, handleIn: [cx2 - cx, cy2 - cy], handleOut: null });
      prevControl = { x: cx2, y: cy2 };
    } else if (c === 'c' && p.length >= 6) {
      const cx1 = cx + p[0]! * scale,
        cy1 = cy + p[1]! * scale;
      const cx2 = cx + p[2]! * scale,
        cy2 = cy + p[3]! * scale;
      cx += p[4]! * scale;
      cy += p[5]! * scale;
      const last = points[points.length - 1];
      if (last) {
        last.handleOut = [cx1 - last.x, cy1 - last.y];
      }
      points.push({ x: cx, y: cy, handleIn: [cx2 - cx, cy2 - cy], handleOut: null });
      prevControl = { x: cx2, y: cy2 };
    } else if (c === 'S' && p.length >= 4) {
      const cx2 = p[0]! * scale,
        cy2 = p[1]! * scale;
      cx = p[2]! * scale;
      cy = p[3]! * scale;
      const last = points[points.length - 1];
      if (last) {
        const reflectX = prevControl ? 2 * last.x - prevControl.x : last.x;
        const reflectY = prevControl ? 2 * last.y - prevControl.y : last.y;
        last.handleOut = [reflectX - last.x, reflectY - last.y];
      }
      points.push({ x: cx, y: cy, handleIn: [cx2 - cx, cy2 - cy], handleOut: null });
      prevControl = { x: cx2, y: cy2 };
    } else if (c === 's' && p.length >= 4) {
      const cx2 = cx + p[0]! * scale,
        cy2 = cy + p[1]! * scale;
      cx += p[2]! * scale;
      cy += p[3]! * scale;
      const last = points[points.length - 1];
      if (last) {
        const reflectX = prevControl ? 2 * last.x - prevControl.x : last.x;
        const reflectY = prevControl ? 2 * last.y - prevControl.y : last.y;
        last.handleOut = [reflectX - last.x, reflectY - last.y];
      }
      points.push({ x: cx, y: cy, handleIn: [cx2 - cx, cy2 - cy], handleOut: null });
      prevControl = { x: cx2, y: cy2 };
    } else if (c === 'Q' && p.length >= 4) {
      const qx = p[0]! * scale,
        qy = p[1]! * scale;
      cx = p[2]! * scale;
      cy = p[3]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = { x: qx, y: qy };
    } else if (c === 'q' && p.length >= 4) {
      const qx = cx + p[0]! * scale,
        qy = cy + p[1]! * scale;
      cx += p[2]! * scale;
      cy += p[3]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = { x: qx, y: qy };
    } else if (c === 'T' && p.length >= 2) {
      cx = p[0]! * scale;
      cy = p[1]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 't' && p.length >= 2) {
      cx += p[0]! * scale;
      cy += p[1]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'A' || c === 'a') {
      // Arc-to: approximate with line segments. Skipping full arc math for MVP.
      if (p.length >= 7) {
        const isRel = c === 'a';
        const rx = p[0]! * scale;
        const ry = p[1]! * scale;
        const xAxisRot = p[2]!;
        const largeArc = p[3]!;
        const sweep = p[4]!;
        const ex = isRel ? cx + p[5]! * scale : p[5]! * scale;
        const ey = isRel ? cy + p[6]! * scale : p[6]! * scale;
        const segments = approximateArc(
          cx,
          cy,
          rx,
          ry,
          xAxisRot,
          largeArc !== 0,
          sweep !== 0,
          ex,
          ey,
        );
        for (const seg of segments) {
          points.push({ x: seg.x, y: seg.y, handleIn: null, handleOut: null });
        }
        cx = ex;
        cy = ey;
        prevControl = null;
      }
    } else if (c === 'Z' || c === 'z') {
      closed = true;
    }
  }

  return { points, closed };
}

interface PathCommand {
  command: string;
  params: number[];
}

function tokenizePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let m: RegExpExecArray | null;
  m = re.exec(d);
  while (m !== null) {
    const cmd = m[1]!;
    const params = (m[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    commands.push({ command: cmd, params });
    m = re.exec(d);
  }
  return commands;
}

function approximateArc(
  _cx: number,
  _cy: number,
  _rx: number,
  _ry: number,
  _xAxisRot: number,
  _largeArc: boolean,
  _sweep: boolean,
  ex: number,
  ey: number,
): Array<{ x: number; y: number }> {
  // Simplified: just emit endpoint (connects with straight line)
  return [{ x: ex, y: ey }];
}

// ─── Transform parsing ──────────────────────────────────────────────────────

function parseTransform(transformStr: string): Affine {
  let m0 = 1,
    m1 = 0,
    m2 = 0,
    m3 = 1,
    m4 = 0,
    m5 = 0;

  const matrixMatch = transformStr.match(/matrix\(([^)]+)\)/);
  if (matrixMatch) {
    const raw = matrixMatch[1];
    if (raw) {
      const parts = raw.split(/[\s,]+/).map(Number);
      if (parts.length >= 6) {
        return [parts[0]!, parts[1]!, parts[2]!, parts[3]!, parts[4]!, parts[5]!] as Affine;
      }
    }
  }

  const translateMatch = transformStr.match(/translate\(([^)]+)\)/);
  if (translateMatch) {
    const raw = translateMatch[1];
    if (raw) {
      const parts = raw.split(/[\s,]+/).map(Number);
      m4 = parts[0] ?? 0;
      m5 = parts[1] ?? 0;
    }
  }

  const scaleMatch = transformStr.match(/scale\(([^)]+)\)/);
  if (scaleMatch) {
    const raw = scaleMatch[1];
    if (raw) {
      const parts = raw.split(/[\s,]+/).map(Number);
      m0 = parts[0] ?? 1;
      m3 = parts[1] ?? parts[0] ?? 1;
    }
  }

  const rotateMatch = transformStr.match(/rotate\(([^)]+)\)/);
  if (rotateMatch) {
    const raw = rotateMatch[1];
    if (raw) {
      const parts = raw.split(/[\s,]+/).map(Number);
      const angle = (parts[0] ?? 0) * (Math.PI / 180);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const tx = parts[1] ?? 0;
      const ty = parts[2] ?? 0;
      const a = m0 * cos - m2 * sin;
      const b = m1 * cos - m3 * sin;
      const c = m0 * sin + m2 * cos;
      const d = m1 * sin + m3 * cos;
      const e = m4 + tx * (1 - cos) + ty * sin;
      const f = m5 - tx * sin + ty * (1 - cos);
      return [a, b, c, d, e, f] as Affine;
    }
  }

  const skewXMatch = transformStr.match(/skewX\(([^)]+)\)/);
  if (skewXMatch) {
    const angle = parseFloat(skewXMatch[1]!) * (Math.PI / 180);
    m2 = Math.tan(angle);
  }

  const skewYMatch = transformStr.match(/skewY\(([^)]+)\)/);
  if (skewYMatch) {
    const angle = parseFloat(skewYMatch[1]!) * (Math.PI / 180);
    m1 = Math.tan(angle);
  }

  return [m0, m1, m2, m3, m4, m5] as Affine;
}

function composeTransforms(transforms: string[]): Affine {
  let result: Affine = [1, 0, 0, 1, 0, 0];
  for (const t of transforms) {
    const m = parseTransform(t);
    result = multiplyAffine(result, m);
  }
  return result;
}

function composeWithOffset(transform: Affine, x: number, y: number): Affine {
  return multiplyAffine(transform, [1, 0, 0, 1, x, y]);
}

function multiplyAffine(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ] as Affine;
}

// ─── Color parsing ──────────────────────────────────────────────────────────

export function parseSvgColor(colorStr: string): ManagedColor | null {
  if (!colorStr || colorStr === 'none') return null;

  // #rgb / #rrggbb
  const hexMatch = colorStr.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0], 16);
      const g = parseInt(hex[1]! + hex[1], 16);
      const b = parseInt(hex[2]! + hex[2], 16);
      return { space: 'rgb' as const, r, g, b, a: 255 };
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { space: 'rgb' as const, r, g, b, a: 255 };
  }

  // rgb() / rgba()
  const rgbMatch = colorStr.match(
    /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)/,
  );
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!, 10);
    const g = parseInt(rgbMatch[2]!, 10);
    const b = parseInt(rgbMatch[3]!, 10);
    const a = rgbMatch[4] !== undefined ? Math.round(parseFloat(rgbMatch[4]) * 255) : 255;
    return { space: 'rgb' as const, r: r, g: g, b: b, a: a };
  }

  // hsl() / hsla()
  const hslMatch = colorStr.match(
    /hsla?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*(?:,\s*([0-9.]+))?\s*\)/,
  );
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]!) % 360;
    const s = Math.max(0, Math.min(100, parseFloat(hslMatch[2]!))) / 100;
    const l = Math.max(0, Math.min(100, parseFloat(hslMatch[3]!))) / 100;
    const a = hslMatch[4] !== undefined ? Math.round(parseFloat(hslMatch[4]) * 255) : 255;
    const [r, g, b] = hslToRgb(h < 0 ? h + 360 : h, s, l);
    return { space: 'rgb' as const, r, g, b, a };
  }

  // icc-color(name, v1, v2, v3, ...) — SVG 1.1 color with ICC profile
  const iccMatch = colorStr.match(
    /icc-color\s*\(\s*([A-Za-z][A-Za-z0-9_-]*)\s*(?:,\s*([0-9.,\s]*))?\s*\)/,
  );
  if (iccMatch) {
    const profile = iccMatch[1]!;
    const rawValues = (iccMatch[2] ?? '')
      .split(',')
      .map((v) => parseFloat(v.trim()))
      .filter((v) => Number.isFinite(v));
    const r = Math.max(0, Math.min(255, Math.round(rawValues[0] ?? 0)));
    const g = Math.max(0, Math.min(255, Math.round(rawValues[1] ?? 0)));
    const b = Math.max(0, Math.min(255, Math.round(rawValues[2] ?? 0)));
    return { space: 'rgb' as const, r, g, b, a: 255, profile };
  }

  // currentColor — unresolved at parse time, caller must inherit from context
  if (colorStr.trim() === 'currentColor') return null;

  // Named colors (common subset)
  const named: Record<string, ManagedColor> = {
    black: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
    white: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 },
    red: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
    green: { space: 'rgb' as const, r: 0, g: 128, b: 0, a: 255 },
    blue: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 },
    yellow: { space: 'rgb' as const, r: 255, g: 255, b: 0, a: 255 },
    cyan: { space: 'rgb' as const, r: 0, g: 255, b: 255, a: 255 },
    magenta: { space: 'rgb' as const, r: 255, g: 0, b: 255, a: 255 },
    gray: { space: 'rgb' as const, r: 128, g: 128, b: 128, a: 255 },
    grey: { space: 'rgb' as const, r: 128, g: 128, b: 128, a: 255 },
    orange: { space: 'rgb' as const, r: 255, g: 165, b: 0, a: 255 },
    purple: { space: 'rgb' as const, r: 128, g: 0, b: 128, a: 255 },
    pink: { space: 'rgb' as const, r: 255, g: 192, b: 203, a: 255 },
    transparent: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    silver: { space: 'rgb' as const, r: 192, g: 192, b: 192, a: 255 },
    maroon: { space: 'rgb' as const, r: 128, g: 0, b: 0, a: 255 },
    navy: { space: 'rgb' as const, r: 0, g: 0, b: 128, a: 255 },
    olive: { space: 'rgb' as const, r: 128, g: 128, b: 0, a: 255 },
    teal: { space: 'rgb' as const, r: 0, g: 128, b: 128, a: 255 },
    lime: { space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 },
    aqua: { space: 'rgb' as const, r: 0, g: 255, b: 255, a: 255 },
    fuchsia: { space: 'rgb' as const, r: 255, g: 0, b: 255, a: 255 },
  };

  const lower = colorStr.toLowerCase().trim();
  if (named[lower]) return named[lower];

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** HSL (h: 0–360, s/l: 0–1) → RGB (0–255) */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function parsePoints(pointsStr: string, scale: number): Array<{ x: number; y: number }> {
  const parts = pointsStr.trim().split(/[\s,]+/);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const x = parseFloat(parts[i]!) * scale;
    const y = parseFloat(parts[i + 1]!) * scale;
    points.push({ x, y });
  }
  return points;
}

function fitPolygon(points: Array<{ x: number; y: number }>): {
  cx: number;
  cy: number;
  radius: number;
  sides: number;
} {
  let cx = 0,
    cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  const radius = Math.max(...points.map((p) => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)));
  const sides = Math.min(12, Math.max(3, Math.round(points.length / 2)));
  return { cx, cy, radius, sides };
}

function computeGroupBounds(
  doc: Document,
  ids: string[],
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n) continue;
    const tx = n.transform[4] ?? 0;
    const ty = n.transform[5] ?? 0;
    let bw = 0,
      bh = 0;
    if (n.kind === 'shape') {
      const s = n.shape;
      if (s.kind === 'rect') {
        bw = s.w;
        bh = s.h;
      } else if (s.kind === 'circle') {
        bw = s.r * 2;
        bh = s.r * 2;
      } else if (s.kind === 'ellipse') {
        bw = s.rx * 2;
        bh = s.ry * 2;
      } else if (s.kind === 'polygon') {
        bw = s.radius * 2;
        bh = s.radius * 2;
      } else if (s.kind === 'star') {
        bw = s.outerRadius * 2;
        bh = s.outerRadius * 2;
      } else if (s.kind === 'line' || s.kind === 'arrow') {
        bw = Math.abs(s.to[0] - s.from[0]) || 4;
        bh = Math.abs(s.to[1] - s.from[1]) || 4;
      }
    } else if (n.kind === 'text') {
      bw = (n.fontSize ?? 16) * 6;
      bh = (n.fontSize ?? 16) * 1.4;
    }
    minX = Math.min(minX, tx);
    minY = Math.min(minY, ty);
    maxX = Math.max(maxX, tx + bw);
    maxY = Math.max(maxY, ty + bh);
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function adjustNodePosition(doc: Document, id: string, dx: number, dy: number): void {
  const n = doc.nodes[id];
  if (!n) return;
  doc.nodes[id] = {
    ...n,
    transform: [
      n.transform[0],
      n.transform[1],
      n.transform[2],
      n.transform[3],
      (n.transform[4] ?? 0) + dx,
      (n.transform[5] ?? 0) + dy,
    ] as Affine,
  } as SceneNode;
}

function parseUnit(value: string): number | null {
  const m = value.trim().match(/^([\d.]+)(px|pt|cm|mm|in|%)?$/);
  if (!m) return null;
  const num = parseFloat(m[1]!);
  const unit = m[2];
  if (unit === 'pt') return num * 1.333;
  if (unit === 'cm') return num * 37.795;
  if (unit === 'mm') return num * 3.7795;
  if (unit === 'in') return num * 96;
  return num;
}

function parseCssStyle(styleStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const decl of styleStr.split(';')) {
    const colon = decl.indexOf(':');
    if (colon > 0) {
      const key = decl.slice(0, colon).trim();
      const value = decl.slice(colon + 1).trim();
      if (key && value) result[key] = value;
    }
  }
  return result;
}

// ─── XML parser (string-based, no DOMParser) ────────────────────────────────
// Uses a cursor-based approach: scan character-by-character to find tag
// boundaries, then recursively parse content.

function nextTagInfo(
  xml: string,
  start: number,
): {
  type: 'open' | 'close' | 'selfclose';
  tag: string;
  attrs: Record<string, string>;
  contentStart: number;
  endPos: number;
} | null {
  // Skip whitespace and find '<'
  let pos = start;
  while (pos < xml.length && xml[pos] === ' ') pos++;
  if (pos >= xml.length || xml[pos] !== '<') return null;

  // Skip comments
  if (xml.startsWith('<!--', pos)) {
    const end = xml.indexOf('-->', pos + 4);
    if (end < 0) return null;
    return nextTagInfo(xml, end + 3);
  }

  const isClose = xml[pos + 1] === '/';
  const nameStart = isClose ? pos + 2 : pos + 1;
  if (nameStart >= xml.length) return null;

  // Read tag name
  let nameEnd = nameStart;
  while (nameEnd < xml.length && /[\w-]/.test(xml[nameEnd]!)) nameEnd++;
  if (nameEnd === nameStart) return null;

  const tag = xml.slice(nameStart, nameEnd);

  // Scan for end of tag: '>' or '/>'
  let inQuote: string | null = null;
  let endPos = nameEnd;
  let selfClose = false;
  let prevChar = '';

  while (endPos < xml.length) {
    const ch = xml[endPos]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '>') {
      if (prevChar === '/') selfClose = true;
      break;
    }
    prevChar = ch;
    endPos++;
  }

  if (endPos >= xml.length) return null;

  const attrStr = xml.slice(nameEnd, selfClose ? endPos - 1 : endPos).trim();
  const attrs = parseAttrs(attrStr);
  const contentStart = endPos + 1;

  return {
    type: isClose ? 'close' : selfClose ? 'selfclose' : 'open',
    tag,
    attrs,
    contentStart,
    endPos,
  };
}

function parseElement(xml: string, start: number): { el: ParsedElement; endPos: number } | null {
  const info = nextTagInfo(xml, start);
  if (!info || info.type === 'close') return null;

  if (info.type === 'selfclose') {
    return {
      el: { tag: info.tag, attrs: info.attrs, children: [], textContent: '' },
      endPos: info.contentStart,
    };
  }

  // Opening tag: parse children until matching closing tag
  const children: ParsedElement[] = [];
  let pos = info.contentStart;

  while (pos < xml.length) {
    const childInfo = nextTagInfo(xml, pos);
    if (!childInfo) {
      // No more tags, advance past text
      const nextTag = xml.indexOf('<', pos);
      if (nextTag < 0) break;
      pos = nextTag;
      continue;
    }

    if (childInfo.type === 'close' && childInfo.tag === info.tag) {
      const innerText = xml.slice(info.contentStart, childInfo.contentStart);
      const textContent = extractText(innerText);
      return {
        el: { tag: info.tag, attrs: info.attrs, children, textContent },
        endPos: childInfo.contentStart,
      };
    }

    // Nested element or self-closing
    const childResult = parseElement(xml, pos);
    if (childResult) {
      children.push(childResult.el);
      pos = childResult.endPos;
    } else {
      pos = xml.indexOf('<', pos + 1);
      if (pos < 0) break;
    }
  }

  // Unclosed tag
  return {
    el: { tag: info.tag, attrs: info.attrs, children, textContent: '' },
    endPos: xml.length,
  };
}

function parseSingleElement(xml: string): ParsedElement | null {
  const trimmed = xml.trim();
  const result = parseElement(trimmed, 0);
  return result?.el ?? null;
}

function extractText(xml: string): string {
  return xml.replace(/<[^>]*>/g, '').trim();
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  m = re.exec(attrStr);
  while (m !== null) {
    attrs[m[1]!] = m[2] ?? m[3] ?? '';
    m = re.exec(attrStr);
  }
  return attrs;
}

// ─── Parser registration ───────────────────────────────────────────────────

import { registerParser } from './registry';

export function createSvgParser(): ImportParser {
  return {
    format: 'svg',
    parse(data: string | Uint8Array, options?: Partial<ImportOptions>): ImportResult {
      const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
      return parseSvg(str, options);
    },
    supportedExtensions(): string[] {
      return ['svg', 'svgz'];
    },
    canParse(data: string | Uint8Array): boolean {
      const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
      return str.trim().startsWith('<svg') || str.trim().startsWith('<?xml');
    },
  };
}

registerParser(createSvgParser());

// COMPLEXITY: 152 — convertElement (70), clip/mask helpers (35), element
// handlers (30), applyStylesToNode (17). Plan: extract each handler to
// svg/handlers/rect.ts etc.

import type { Affine, PathPoint, Shape } from '@varve/engine';
import type { Document, Fill, FrameNode, ManagedColor, SceneNode } from '@varve/scene';
import {
  addMask,
  addNode,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
  nodeLocalBounds,
} from '@varve/scene';
import type { ImportOptions } from '../types';
import { droppedElementFeature, resolveSvgImageHref } from './resourcePolicy';
import {
  adjustNodePosition,
  composeTransforms,
  composeWithOffset,
  computeGroupBounds,
  fitPolygon,
  maskTypeFromElement,
  multiplyAffine,
  nodeBounds,
  type ParsedElement,
  parseCssStyle,
  parsePathData,
  parsePoints,
  parseSvgColor,
  parseUrlReference,
} from './shared';

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
  const contours = parsed.contours.length
    ? parsed.contours
    : [{ points: parsed.points, closed: parsed.closed }];
  const outer = contours[0];

  if (!outer || outer.points.length < 2) {
    const node = makeShapeNode('', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Path' });
    return { node, warnings: ['Path too short'] };
  }

  const style = parseCssStyle(el.attrs.style ?? '');
  const rawFillRule = el.attrs['fill-rule'] ?? style['fill-rule'];
  const fillRule =
    rawFillRule?.toLowerCase() === 'evenodd' || rawFillRule?.toLowerCase() === 'nonzero'
      ? (rawFillRule.toLowerCase() as 'evenodd' | 'nonzero')
      : undefined;
  const shape: Shape = {
    kind: 'path',
    points: outer.points,
    // SVG fills implicitly close every subpath. Preserve an actually open
    // single contour for stroke-only paths, but compound subpaths are regions.
    closed: outer.closed || contours.length > 1,
    tolerance: 3,
    ...(contours.length > 1 ? { holes: contours.slice(1).map((contour) => contour.points) } : {}),
    ...(fillRule ? { fillRule } : {}),
  };
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
  unsupported: string[],
): { node: SceneNode; warnings: string[] } | null {
  const x = parseFloat(el.attrs.x ?? '0') * opts.scale;
  const y = parseFloat(el.attrs.y ?? '0') * opts.scale;
  const w = parseFloat(el.attrs.width ?? '100') * opts.scale;
  const h = parseFloat(el.attrs.height ?? '100') * opts.scale;
  const decision = resolveSvgImageHref(el.attrs.href ?? el.attrs['xlink:href'] ?? '');
  if (!decision.allowed) {
    // Dropping the node beats leaving an invisible placeholder the user
    // cannot explain. The report names what went missing and why.
    unsupported.push(decision.feature);
    return null;
  }
  const href = decision.href;
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

function svgStopOffset(value: string | undefined): number {
  if (!value) return 0;
  const raw = value.trim();
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, raw.endsWith('%') ? parsed / 100 : parsed));
}

function svgStopColor(stop: ParsedElement): ManagedColor | null {
  const style = parseCssStyle(stop.attrs.style ?? '');
  const color = stop.attrs['stop-color'] ?? style['stop-color'] ?? 'transparent';
  const parsed = parseSvgColor(color);
  if (!parsed) return null;
  const opacity = Number.parseFloat(stop.attrs['stop-opacity'] ?? style['stop-opacity'] ?? '1');
  const alpha = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  return parsed.space === 'rgb' ? { ...parsed, a: Math.round(parsed.a * alpha) } : parsed;
}

function svgGradientCoordinate(
  value: string | undefined,
  fallback: number,
  axisLength: number,
  scale: number,
): number {
  if (!value) return fallback;
  const raw = value.trim();
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return raw.endsWith('%') ? (numeric / 100) * axisLength : numeric * scale;
}

function gradientTransformFromSvg(
  def: ParsedElement,
  node: SceneNode,
  scale: number,
  warnings: string[],
): Affine | null {
  const bounds = nodeLocalBounds(node);
  if (!bounds || bounds.w === 0 || bounds.h === 0) {
    warnings.push(`SVG gradient #${def.attrs.id ?? '(anonymous)'} has no usable target bounds`);
    return null;
  }

  const objectBoundingBox = (def.attrs.gradientUnits ?? 'objectBoundingBox') !== 'userSpaceOnUse';
  const xLength = objectBoundingBox ? 1 : bounds.w;
  const yLength = objectBoundingBox ? 1 : bounds.h;
  const coordinateScale = objectBoundingBox ? 1 : scale;
  if (!objectBoundingBox) {
    const percentageAttribute = ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r'].find((name) =>
      def.attrs[name]?.trim().endsWith('%'),
    );
    if (percentageAttribute) {
      warnings.push(
        `SVG gradient #${def.attrs.id ?? '(anonymous)'} uses userSpaceOnUse percentages; the imported field is normalized to the target bounds`,
      );
    }
  }
  const x = (name: string, fallback: number) =>
    svgGradientCoordinate(def.attrs[name], fallback, xLength, coordinateScale);
  const y = (name: string, fallback: number) =>
    svgGradientCoordinate(def.attrs[name], fallback, yLength, coordinateScale);
  const rawGradientTransform = def.attrs.gradientTransform
    ? composeTransforms([def.attrs.gradientTransform])
    : ([1, 0, 0, 1, 0, 0] as Affine);
  // SVG coordinate values are scaled on import, so its translation terms must
  // be scaled too. Unit-box gradients are dimensionless and are scaled by the
  // target bounds below instead.
  const gradientTransform: Affine = objectBoundingBox
    ? rawGradientTransform
    : [
        rawGradientTransform[0],
        rawGradientTransform[1],
        rawGradientTransform[2],
        rawGradientTransform[3],
        rawGradientTransform[4] * scale,
        rawGradientTransform[5] * scale,
      ];

  if (def.tag === 'linearGradient') {
    const x1 = x('x1', 0);
    const y1 = y('y1', 0);
    const x2 = x('x2', objectBoundingBox ? 1 : 1 * scale);
    const y2 = y('y2', 0);
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) {
      warnings.push(
        `SVG gradient #${def.attrs.id ?? '(anonymous)'} has coincident linear endpoints`,
      );
      return null;
    }
    // Start and end occupy canonical [0,.5] and [1,.5]. The perpendicular
    // basis is deliberately retained, rather than collapsing the field to an
    // angle, so a following SVG gradientTransform can introduce skew/flip.
    const unitToGradient: Affine = [dx, dy, -dy, dx, x1 + dy * 0.5, y1 - dx * 0.5];
    const transformed = multiplyAffine(gradientTransform, unitToGradient);
    return objectBoundingBox
      ? multiplyAffine([bounds.w, 0, 0, bounds.h, bounds.x, bounds.y], transformed)
      : transformed;
  }

  const cx = x('cx', objectBoundingBox ? 0.5 : 0.5 * scale);
  const cy = y('cy', objectBoundingBox ? 0.5 : 0.5 * scale);
  const radius = svgGradientCoordinate(
    def.attrs.r,
    objectBoundingBox ? 0.5 : 0.5 * scale,
    Math.min(xLength, yLength),
    coordinateScale,
  );
  if (radius <= 0) {
    warnings.push(`SVG gradient #${def.attrs.id ?? '(anonymous)'} has a non-positive radius`);
    return null;
  }
  const focalX = x('fx', cx);
  const focalY = y('fy', cy);
  if (Math.abs(focalX - cx) > 1e-9 || Math.abs(focalY - cy) > 1e-9) {
    warnings.push(
      `SVG gradient #${def.attrs.id ?? '(anonymous)'} has an off-centre focal point; the imported affine radial field uses the centre`,
    );
  }
  // Canonical radial U/V endpoints are half a matrix column from its centre.
  const unitToGradient: Affine = [2 * radius, 0, 0, 2 * radius, cx - radius, cy - radius];
  const transformed = multiplyAffine(gradientTransform, unitToGradient);
  return objectBoundingBox
    ? multiplyAffine([bounds.w, 0, 0, bounds.h, bounds.x, bounds.y], transformed)
    : transformed;
}

function gradientFillFromSvg(
  def: ParsedElement,
  node: SceneNode,
  scale: number,
  warnings: string[],
): Fill | null {
  const stops = def.children
    .filter((child) => child.tag === 'stop')
    .map((stop) => {
      const color = svgStopColor(stop);
      return color ? { position: svgStopOffset(stop.attrs.offset), color } : null;
    })
    .filter((stop): stop is { position: number; color: ManagedColor } => stop !== null)
    .sort((a, b) => a.position - b.position);
  if (stops.length < 2) {
    warnings.push(`SVG gradient #${def.attrs.id ?? '(anonymous)'} has fewer than two usable stops`);
    return null;
  }

  const interpolationSpace =
    def.attrs['color-interpolation']?.toLowerCase() === 'linearrgb' ? 'linear-srgb' : 'srgb';
  const spread = def.attrs.spreadMethod;
  const tilingMode = spread === 'repeat' || spread === 'reflect' ? spread : 'none';
  const transform = gradientTransformFromSvg(def, node, scale, warnings);
  if (!transform) return null;

  return {
    type: 'gradient',
    gradient: {
      type: def.tag === 'radialGradient' ? 'radial' : 'linear',
      stops,
      transform,
      interpolationSpace,
      tilingMode,
    },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

function applyStylesToNode(
  node: SceneNode,
  el: ParsedElement,
  defs: Map<string, ParsedElement>,
  scale: number,
  warnings: string[],
): SceneNode {
  let fill = el.attrs.fill ?? el.attrs.style;
  let stroke = el.attrs.stroke;
  let strokeWidth = el.attrs['stroke-width'];
  let opacity = el.attrs.opacity;
  let fillOpacity = el.attrs['fill-opacity'];
  let strokeOpacity = el.attrs['stroke-opacity'];

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
    const gradientId = parseUrlReference(fill);
    const gradientDef = gradientId ? defs.get(gradientId) : undefined;
    if (
      gradientDef &&
      (gradientDef.tag === 'linearGradient' || gradientDef.tag === 'radialGradient')
    ) {
      const gradientFill = gradientFillFromSvg(gradientDef, result, scale, warnings);
      if (gradientFill) result = { ...result, fills: [gradientFill] };
    } else {
      if (gradientId) warnings.push(`SVG fill references unsupported resource: #${gradientId}`);
      const parsedColor = parseSvgColor(fill);
      if (parsedColor) {
        result = { ...result, fill: parsedColor };
      }
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

function buildMaskSourceNode(
  defEl: ParsedElement,
  doc: Document,
  defs: Map<string, ParsedElement>,
  transforms: string[],
  opts: ImportOptions,
  warnings: string[],
  unsupported: string[],
): { doc: Document; sourceId: string | null } {
  const childNodes: string[] = [];
  let d = doc;

  for (const child of defEl.children) {
    const r = convertElement(child, d, defs, transforms, opts, warnings, unsupported);
    d = r.doc;
    childNodes.push(...r.ids);
  }

  if (childNodes.length === 0) {
    return { doc: d, sourceId: null };
  }

  d = {
    ...d,
    rootChildren: d.rootChildren.filter((nid) => !childNodes.includes(nid)),
  };

  if (childNodes.length === 1) {
    return { doc: d, sourceId: childNodes[0]! };
  }

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

function applySvgClipOrMask(
  doc: Document,
  containerId: string,
  defEl: ParsedElement,
  maskType: 'clip' | 'alpha' | 'luminance',
  opts: ImportOptions,
  defs: Map<string, ParsedElement>,
  transforms: string[],
  warnings: string[],
  unsupported: string[],
): Document {
  const { doc: d2, sourceId } = buildMaskSourceNode(
    defEl,
    doc,
    defs,
    transforms,
    opts,
    warnings,
    unsupported,
  );
  if (!sourceId) {
    warnings.push('clipPath/mask definition is empty — skipping');
    return d2;
  }

  const container = d2.nodes[containerId];
  if (!container) return d2;
  const children = 'children' in container ? container.children : undefined;
  let d = d2;
  if (children && !children.includes(sourceId)) {
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

function applyGroupClipOrMask(
  doc: Document,
  groupId: string,
  el: ParsedElement,
  defs: Map<string, ParsedElement>,
  transforms: string[],
  opts: ImportOptions,
  warnings: string[],
  unsupported: string[],
): Document {
  let d = doc;

  const clipRef = parseUrlReference(el.attrs['clip-path'] ?? '');
  if (clipRef) {
    const clipDef = defs.get(clipRef);
    if (clipDef) {
      d = applySvgClipOrMask(
        d,
        groupId,
        clipDef,
        'clip',
        opts,
        defs,
        transforms,
        warnings,
        unsupported,
      );
    } else {
      warnings.push(`clip-path references unknown id: #${clipRef}`);
    }
  }

  const maskRef = parseUrlReference(el.attrs.mask ?? '');
  if (maskRef) {
    const maskDef = defs.get(maskRef);
    if (maskDef) {
      const maskType = maskTypeFromElement(maskDef);
      d = applySvgClipOrMask(
        d,
        groupId,
        maskDef,
        maskType,
        opts,
        defs,
        transforms,
        warnings,
        unsupported,
      );
    } else {
      warnings.push(`mask references unknown id: #${maskRef}`);
    }
  }

  return d;
}

function wrapNodeInMaskedGroup(
  doc: Document,
  nodeId: string,
  el: ParsedElement,
  defs: Map<string, ParsedElement>,
  transforms: string[],
  opts: ImportOptions,
  warnings: string[],
  unsupported: string[],
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
  d = applyGroupClipOrMask(d, groupId, el, defs, transforms, opts, warnings, unsupported);
  return { doc: d, groupId };
}

export function convertElement(
  el: ParsedElement,
  doc: Document,
  defs: Map<string, ParsedElement>,
  inheritedTransform: string[],
  opts: ImportOptions,
  warnings: string[],
  unsupported: string[],
  visitedIds = new Set<string>(),
): { doc: Document; ids: string[] } {
  const dropped = droppedElementFeature(el.tag);
  if (dropped) {
    // Inert either way — nothing here is inserted into the DOM — but a
    // silent drop reads as corrupt output, so name it in the report.
    unsupported.push(dropped);
    return { doc, ids: [] };
  }

  const ids: string[] = [];

  if (el.tag === 'defs') return { doc, ids };

  if (el.tag === 'svg') {
    for (const child of el.children) {
      const r = convertElement(
        child,
        doc,
        defs,
        inheritedTransform,
        opts,
        warnings,
        unsupported,
        visitedIds,
      );
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
      const r = convertElement(
        child,
        gDoc,
        defs,
        transforms,
        opts,
        warnings,
        unsupported,
        visitedIds,
      );
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
      gDoc = applyGroupClipOrMask(gDoc, id, el, defs, transforms, opts, warnings, unsupported);
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
          unsupported,
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
      result = convertImage(el, transforms, opts, unsupported);
      break;
    default:
      break;
  }

  if (result) {
    const { id, doc: d2 } = nextNodeId(doc);
    const styled = applyStylesToNode(result.node, el, defs, opts.scale, warnings);
    const node = { ...styled, id } as SceneNode;
    doc = addNode(d2, node);
    ids.push(id);

    const clipRef = parseUrlReference(el.attrs['clip-path'] ?? '');
    const maskRef = parseUrlReference(el.attrs.mask ?? '');
    if (clipRef || maskRef) {
      const wrapped = wrapNodeInMaskedGroup(
        doc,
        id,
        el,
        defs,
        transforms,
        opts,
        warnings,
        unsupported,
      );
      if (wrapped) {
        doc = wrapped.doc;
        ids.length = 0;
        ids.push(wrapped.groupId);
      }
    }
  }

  return { doc, ids };
}

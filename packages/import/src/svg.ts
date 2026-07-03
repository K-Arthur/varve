/**
 * SVG parser — converts SVG XML into a Strata Document using a string-based
 * recursive descent approach (no DOMParser dependency).
 *
 * Research basis: SVG 1.1 (W3C Recommendation), Adobe Illustrator SVG export.
 */
import type { Affine, Color, PathPoint, Shape } from '@strata/engine';
import type { Document, FrameNode, SceneNode } from '@strata/scene';
import {
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
  if (!root || root.tag !== 'svg') {
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
): { doc: Document; ids: string[] } {
  const ids: string[] = [];

  if (el.tag === 'defs') return { doc, ids };

  if (el.tag === 'svg') {
    for (const child of el.children) {
      const r = convertElement(child, doc, defs, inheritedTransform, opts, warnings);
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
      const r = convertElement(child, gDoc, defs, transforms, opts, warnings);
      gDoc = r.doc;
      gIds.push(...r.ids);
    }
    if (gIds.length > 0) {
      const { id } = nextNodeId(gDoc);
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
      ids.push(id);
      return { doc: gDoc, ids };
    }
    return { doc: gDoc, ids: gIds };
  }

  if (el.tag === 'use') {
    const href = el.attrs.href ?? el.attrs['xlink:href'];
    if (href && href.startsWith('#')) {
      const refId = href.slice(1);
      const ref = defs.get(refId);
      if (ref) {
        const x = parseFloat(el.attrs.x ?? '0');
        const y = parseFloat(el.attrs.y ?? '0');
        const useTransform = `translate(${x},${y})`;
        const r = convertElement(ref, doc, defs, [...transforms, useTransform], opts, warnings);
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
    fill: [0, 0, 0, 0] as Color,
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
        fill: [0, 0, 0, 0] as Color,
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
    result = { ...result, fill: [0, 0, 0, 0] as Color };
  }

  if (opacity) {
    const op = parseFloat(opacity);
    if (!isNaN(op)) {
      result = { ...result, opacity: op };
    }
  }

  if (fillOpacity) {
    const fop = parseFloat(fillOpacity);
    if (!isNaN(fop) && 'fills' in result && result.fills && result.fills.length > 0) {
      const fills = [...result.fills];
      fills[0] = { ...fills[0]!, opacity: fop };
      result = { ...result, fills } as SceneNode;
    }
  }

  if (stroke && stroke !== 'none') {
    const parsedStrokeColor = parseSvgColor(stroke);
    const sw = strokeWidth ? parseFloat(strokeWidth) : 1;
    const strokeOpacityVal = strokeOpacity ? parseFloat(strokeOpacity) : 1;
    if (parsedStrokeColor) {
      const strokeColor: Color = [
        parsedStrokeColor[0],
        parsedStrokeColor[1],
        parsedStrokeColor[2],
        Math.round((parsedStrokeColor[3] ?? 255) * strokeOpacityVal),
      ];
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
    const parts = matrixMatch[1]!.split(/[\s,]+/).map(Number);
    if (parts.length >= 6) {
      return [parts[0]!, parts[1]!, parts[2]!, parts[3]!, parts[4]!, parts[5]!] as Affine;
    }
  }

  const translateMatch = transformStr.match(/translate\(([^)]+)\)/);
  if (translateMatch) {
    const parts = translateMatch[1]!.split(/[\s,]+/).map(Number);
    m4 = parts[0] ?? 0;
    m5 = parts[1] ?? 0;
  }

  const scaleMatch = transformStr.match(/scale\(([^)]+)\)/);
  if (scaleMatch) {
    const parts = scaleMatch[1]!.split(/[\s,]+/).map(Number);
    m0 = parts[0] ?? 1;
    m3 = parts[1] ?? parts[0] ?? 1;
  }

  const rotateMatch = transformStr.match(/rotate\(([^)]+)\)/);
  if (rotateMatch) {
    const parts = rotateMatch[1]!.split(/[\s,]+/).map(Number);
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

function parseSvgColor(colorStr: string): Color | null {
  if (!colorStr || colorStr === 'none') return null;

  // #rgb / #rrggbb
  const hexMatch = colorStr.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0], 16);
      const g = parseInt(hex[1]! + hex[1], 16);
      const b = parseInt(hex[2]! + hex[2], 16);
      return [r, g, b, 255] as Color;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b, 255] as Color;
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
    return [r, g, b, a] as Color;
  }

  // Named colors (common subset)
  const named: Record<string, Color> = {
    black: [0, 0, 0, 255],
    white: [255, 255, 255, 255],
    red: [255, 0, 0, 255],
    green: [0, 128, 0, 255],
    blue: [0, 0, 255, 255],
    yellow: [255, 255, 0, 255],
    cyan: [0, 255, 255, 255],
    magenta: [255, 0, 255, 255],
    gray: [128, 128, 128, 255],
    grey: [128, 128, 128, 255],
    orange: [255, 165, 0, 255],
    purple: [128, 0, 128, 255],
    pink: [255, 192, 203, 255],
    transparent: [0, 0, 0, 0],
    silver: [192, 192, 192, 255],
    maroon: [128, 0, 0, 255],
    navy: [0, 0, 128, 255],
    olive: [128, 128, 0, 255],
    teal: [0, 128, 128, 255],
    lime: [0, 255, 0, 255],
    aqua: [0, 255, 255, 255],
    fuchsia: [255, 0, 255, 255],
  };

  const lower = colorStr.toLowerCase().trim();
  if (named[lower]) return named[lower];

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

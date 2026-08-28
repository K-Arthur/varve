// COMPLEXITY: 87 — path data parser (big switch), color parser (multi-branch),
// XML parser (recursive descent). Plan: extract XML parser to its own module
// (svg/xml.ts) and path parser to svg/path.ts.

import type { Affine, PathPoint } from '@varve/engine';
import type { Document, ManagedColor, SceneNode } from '@varve/scene';

export interface ParsedElement {
  tag: string;
  attrs: Record<string, string>;
  children: ParsedElement[];
  textContent: string;
}

interface PathCommand {
  command: string;
  params: number[];
}

export function tokenizePath(d: string): PathCommand[] {
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

export function approximateArc(
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
  return [{ x: ex, y: ey }];
}

export interface ParsedPathData {
  /** First contour, retained for legacy callers. */
  points: PathPoint[];
  /** Whether the first contour was explicitly closed with Z. */
  closed: boolean;
  /** Every SVG subpath, in source order. */
  contours: Array<{ points: PathPoint[]; closed: boolean }>;
}

export function parsePathData(d: string, scale: number): ParsedPathData {
  const commands = tokenizePath(d);
  const points: PathPoint[] = [];
  const contours: Array<{ points: PathPoint[]; closed: boolean }> = [];
  let closed = false;
  let cx = 0,
    cy = 0;
  let prevControl: { x: number; y: number } | null = null;

  const finishContour = () => {
    if (points.length > 0) {
      contours.push({ points: [...points], closed });
    }
  };

  for (const cmd of commands) {
    const c = cmd.command;
    const p = cmd.params;

    if (c === 'M' && p.length >= 2) {
      finishContour();
      points.length = 0;
      closed = false;
      cx = p[0]! * scale;
      cy = p[1]! * scale;
      points.push({ x: cx, y: cy, handleIn: null, handleOut: null });
      prevControl = null;
    } else if (c === 'm' && p.length >= 2) {
      finishContour();
      points.length = 0;
      closed = false;
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

  finishContour();
  const first = contours[0] ?? { points: [], closed: false };
  return { points: first.points, closed: first.closed, contours };
}

export function parseTransform(transformStr: string): Affine {
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

export function multiplyAffine(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ] as Affine;
}

export function composeTransforms(transforms: string[]): Affine {
  let result: Affine = [1, 0, 0, 1, 0, 0];
  for (const t of transforms) {
    const m = parseTransform(t);
    result = multiplyAffine(result, m);
  }
  return result;
}

export function composeWithOffset(transform: Affine, x: number, y: number): Affine {
  return multiplyAffine(transform, [1, 0, 0, 1, x, y]);
}

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

export function parseSvgColor(colorStr: string): ManagedColor | null {
  if (!colorStr || colorStr === 'none') return null;

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

  const rgbMatch = colorStr.match(
    /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)/,
  );
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!, 10);
    const g = parseInt(rgbMatch[2]!, 10);
    const b = parseInt(rgbMatch[3]!, 10);
    const a = rgbMatch[4] !== undefined ? Math.round(parseFloat(rgbMatch[4]) * 255) : 255;
    return { space: 'rgb' as const, r, g, b, a };
  }

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

  if (colorStr.trim() === 'currentColor') return null;

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

export function parsePoints(pointsStr: string, scale: number): Array<{ x: number; y: number }> {
  const parts = pointsStr.trim().split(/[\s,]+/);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const x = parseFloat(parts[i]!) * scale;
    const y = parseFloat(parts[i + 1]!) * scale;
    points.push({ x, y });
  }
  return points;
}

export function fitPolygon(points: Array<{ x: number; y: number }>): {
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

export function parseUnit(value: string): number | null {
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

export function parseCssStyle(styleStr: string): Record<string, string> {
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

export function parseUrlReference(value: string): string | null {
  const match = value.trim().match(/^url\(#([^)]+)\)$/);
  return match ? match[1]! : null;
}

export function maskTypeFromElement(el: ParsedElement): 'alpha' | 'luminance' {
  const maskType = el.attrs['mask-type'];
  if (maskType === 'luminance') return 'luminance';
  return 'alpha';
}

export function computeGroupBounds(
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
      } else if (s.kind === 'path') {
        if (s.points.length > 0) {
          let pMinX = Infinity,
            pMinY = Infinity,
            pMaxX = -Infinity,
            pMaxY = -Infinity;
          for (const pt of s.points) {
            const xs = [pt.x, pt.handleIn?.[0] ?? pt.x, pt.handleOut?.[0] ?? pt.x];
            const ys = [pt.y, pt.handleIn?.[1] ?? pt.y, pt.handleOut?.[1] ?? pt.y];
            for (const v of xs) {
              if (v < pMinX) pMinX = v;
              if (v > pMaxX) pMaxX = v;
            }
            for (const v of ys) {
              if (v < pMinY) pMinY = v;
              if (v > pMaxY) pMaxY = v;
            }
          }
          bw = pMaxX - pMinX;
          bh = pMaxY - pMinY;
        }
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

export function adjustNodePosition(doc: Document, id: string, dx: number, dy: number): void {
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

export function nodeBounds(node: SceneNode): { x: number; y: number; w: number; h: number } {
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
    } else if (s.kind === 'path') {
      if (s.points.length > 0) {
        let pMinX = Infinity,
          pMinY = Infinity,
          pMaxX = -Infinity,
          pMaxY = -Infinity;
        for (const pt of s.points) {
          const xs = [pt.x, pt.handleIn?.[0] ?? pt.x, pt.handleOut?.[0] ?? pt.x];
          const ys = [pt.y, pt.handleIn?.[1] ?? pt.y, pt.handleOut?.[1] ?? pt.y];
          for (const v of xs) {
            if (v < pMinX) pMinX = v;
            if (v > pMaxX) pMaxX = v;
          }
          for (const v of ys) {
            if (v < pMinY) pMinY = v;
            if (v > pMaxY) pMaxY = v;
          }
        }
        bw = pMaxX - pMinX;
        bh = pMaxY - pMinY;
      }
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

export function collectDefs(el: ParsedElement): Map<string, ParsedElement> {
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

// ─── XML parser (string-based, no DOMParser) ────────────────────────────────

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
  let pos = start;
  while (pos < xml.length && xml[pos] === ' ') pos++;
  if (pos >= xml.length || xml[pos] !== '<') return null;

  if (xml.startsWith('<!--', pos)) {
    const end = xml.indexOf('-->', pos + 4);
    if (end < 0) return null;
    return nextTagInfo(xml, end + 3);
  }

  const isClose = xml[pos + 1] === '/';
  const nameStart = isClose ? pos + 2 : pos + 1;
  if (nameStart >= xml.length) return null;

  let nameEnd = nameStart;
  while (nameEnd < xml.length && /[\w-]/.test(xml[nameEnd]!)) nameEnd++;
  if (nameEnd === nameStart) return null;

  const tag = xml.slice(nameStart, nameEnd);

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

  const children: ParsedElement[] = [];
  let pos = info.contentStart;

  while (pos < xml.length) {
    const childInfo = nextTagInfo(xml, pos);
    if (!childInfo) {
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

    const childResult = parseElement(xml, pos);
    if (childResult) {
      children.push(childResult.el);
      pos = childResult.endPos;
    } else {
      pos = xml.indexOf('<', pos + 1);
      if (pos < 0) break;
    }
  }

  return {
    el: { tag: info.tag, attrs: info.attrs, children, textContent: '' },
    endPos: xml.length,
  };
}

export function parseSingleElement(xml: string): ParsedElement | null {
  const trimmed = xml.trim();
  const result = parseElement(trimmed, 0);
  return result?.el ?? null;
}

function extractText(xml: string): string {
  return xml.replace(/<[^>]*>/g, '').trim();
}

export function parseAttrs(attrStr: string): Record<string, string> {
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

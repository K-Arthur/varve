/**
 * Frame container painting for the SVG emitter.
 *
 * A frame paints its own box on the canvas and clips its children to it. The
 * SVG emitter used to share a single `case 'frame': case 'group':` branch that
 * emitted a bare `<g>`, which dropped both: the frame's background vanished
 * from exported SVG and children spilled outside the frame bounds. Groups stay
 * paint-free (the canvas replays their children without painting), so this
 * module is deliberately frame-only.
 *
 * Extracted from `svg.ts` to keep that file's branch count within the
 * complexity ceiling.
 */

import type { FrameNode } from '@varve/scene';

interface FrameBoxElement {
  tag: 'rect' | 'path';
  /** Attribute string appended after the tag name. */
  geometry: string;
}

export interface FrameContainerParams {
  frame: FrameNode;
  /** Transform, compositing style, and mask attributes for the outer group. */
  groupAttributes: string;
  /** Fill/stroke attributes for the frame's own box. */
  paintAttributes: string;
  /** Already-rendered child markup. */
  children: string;
  indent: string;
  /** Comment emitted before the group, e.g. an unbaked-warp note. */
  leadingComment: string;
}

/**
 * Number formatting must match `svg.ts` exactly (2 decimal places, non-finite
 * to `0`), or a fractional corner radius would emit different digits than the
 * rest of the document does. Duplicated rather than imported: `svg.ts` imports
 * this module, so importing back would create a cycle.
 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return (Math.round(n * 100) / 100).toString();
}

function corners(raw: FrameNode['cornerRadius'], limit: number): [number, number, number, number] {
  const values = Array.isArray(raw) ? raw : [raw, raw, raw, raw];
  const [tl = 0, tr = 0, br = 0, bl = 0] = values;
  const clamp = (value: number) => Math.max(0, Math.min(value, limit));
  return [clamp(tl), clamp(tr), clamp(br), clamp(bl)];
}

/** An arc command for a corner, or nothing when the radius is zero. */
function cornerArc(radius: number, toX: number, toY: number): string {
  return radius > 0 ? `A ${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(toX)} ${fmt(toY)}` : '';
}

/**
 * SVG geometry for a frame's authored box.
 *
 * `<rect>` takes a single radius pair, so uniform (or absent) corner radii use
 * it directly and per-corner radii fall back to an equivalent path.
 */
export function frameBoxElement(frame: FrameNode): FrameBoxElement {
  const w = Math.max(0, frame.w);
  const h = Math.max(0, frame.h);
  const [tl, tr, br, bl] = corners(frame.cornerRadius, Math.min(w, h) / 2);

  if (tl === tr && tr === br && br === bl) {
    const radiusAttr = tl > 0 ? ` rx="${fmt(tl)}" ry="${fmt(tl)}"` : '';
    return {
      tag: 'rect',
      geometry: ` x="0" y="0" width="${fmt(w)}" height="${fmt(h)}"${radiusAttr}`,
    };
  }

  const d = [
    `M ${fmt(tl)} 0`,
    `H ${fmt(w - tr)}`,
    cornerArc(tr, w, tr),
    `V ${fmt(h - br)}`,
    cornerArc(br, w - br, h),
    `H ${fmt(bl)}`,
    cornerArc(bl, 0, h - bl),
    `V ${fmt(tl)}`,
    cornerArc(tl, tl, 0),
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
  return { tag: 'path', geometry: ` d="${d}"` };
}

/**
 * `<g>` markup for a frame: optional leading comment, the frame's painted box,
 * then its children clipped to that box unless the frame opts out.
 */
export function frameContainerSvg(params: FrameContainerParams): string {
  const { frame, groupAttributes, paintAttributes, children, indent, leadingComment } = params;
  const box = frameBoxElement(frame);
  const element = `<${box.tag}${box.geometry}`;
  const background = `${indent}  ${element}${paintAttributes} />`;

  const prefix = leadingComment ? `${indent}${leadingComment}` : indent;
  if (frame.clipContent === false) {
    return `${prefix}<g${groupAttributes}>\n${background}\n${children}\n${indent}</g>`;
  }

  const clipId = `frame-clip-${frame.id}`;
  return [
    `${prefix}<g${groupAttributes}>`,
    background,
    `${indent}  <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${element} /></clipPath>`,
    `${indent}  <g clip-path="url(#${clipId})">`,
    children,
    `${indent}  </g>`,
    `${indent}</g>`,
  ].join('\n');
}

import type { Shape } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import { strokePaintToSvg } from './svgPaintFeatures';

type PathShape = Extract<Shape, { kind: 'path' }>;
type SvgPathPoint = PathShape['points'][number];

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return (Math.round(n * 100) / 100).toString();
}

/** Serialize curved and compound path rings without losing closing handles. */
export function pathToData(shape: PathShape): string {
  const ringToCommands = (points: SvgPathPoint[], closed: boolean): string[] => {
    const first = points[0];
    if (!first) return [];
    const commands = [`M ${fmt(first.x)} ${fmt(first.y)}`];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      if (previous.handleOut || current.handleIn) {
        commands.push(
          `C ${fmt(previous.x + (previous.handleOut?.[0] ?? 0))} ${fmt(previous.y + (previous.handleOut?.[1] ?? 0))} ${fmt(current.x + (current.handleIn?.[0] ?? 0))} ${fmt(current.y + (current.handleIn?.[1] ?? 0))} ${fmt(current.x)} ${fmt(current.y)}`,
        );
      } else {
        commands.push(`L ${fmt(current.x)} ${fmt(current.y)}`);
      }
    }
    if (closed && points.length > 1) {
      const last = points[points.length - 1]!;
      if (last.handleOut || first.handleIn) {
        commands.push(
          `C ${fmt(last.x + (last.handleOut?.[0] ?? 0))} ${fmt(last.y + (last.handleOut?.[1] ?? 0))} ${fmt(first.x + (first.handleIn?.[0] ?? 0))} ${fmt(first.y + (first.handleIn?.[1] ?? 0))} ${fmt(first.x)} ${fmt(first.y)}`,
        );
      }
      commands.push('Z');
    }
    return commands;
  };

  const commands = ringToCommands(shape.points, shape.closed);
  for (const hole of shape.holes ?? []) commands.push(...ringToCommands(hole, true));
  return commands.join(' ');
}

const ARROW_SPREAD = Math.PI / 7;

function arrowheadSvgPath(
  from: readonly [number, number],
  to: readonly [number, number],
  size: number,
  style: 'arrow' | 'circle' | 'square' | 'diamond',
  isStart: boolean,
): string {
  const tip = isStart ? from : to;
  const tail = isStart ? to : from;
  const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const transform = (lx: number, ly: number): string =>
    `${(tip[0] + lx * cos - ly * sin).toFixed(2)} ${(tip[1] + lx * sin + ly * cos).toFixed(2)}`;

  switch (style) {
    case 'arrow': {
      const x1 = -size * Math.cos(-ARROW_SPREAD);
      const y1 = -size * Math.sin(-ARROW_SPREAD);
      const x2 = -size * Math.cos(ARROW_SPREAD);
      const y2 = -size * Math.sin(ARROW_SPREAD);
      return `M ${transform(0, 0)} L ${transform(x1, y1)} L ${transform(x2, y2)} Z`;
    }
    case 'circle': {
      const r = size * 0.5;
      return `M ${transform(-r, 0)} A ${r} ${r} 0 1 0 ${transform(r, 0)} A ${r} ${r} 0 1 0 ${transform(-r, 0)} Z`;
    }
    case 'square': {
      const s = size * 0.7;
      return `M ${transform(-s, -s * 0.5)} L ${transform(0, -s * 0.5)} L ${transform(0, s * 0.5)} L ${transform(-s, s * 0.5)} Z`;
    }
    case 'diamond': {
      const s = size * 0.6;
      return `M ${transform(0, 0)} L ${transform(-s, -s * 0.5)} L ${transform(-s * 2, 0)} L ${transform(-s, s * 0.5)} Z`;
    }
  }
}

export function lineArrowheadSvgTags(
  node: SceneNode,
  nodeId: string,
  indent: string,
  withTransform: string,
): string[] {
  if (node.kind !== 'shape') return [];
  const shape = node.shape;
  if (shape.kind !== 'line' && shape.kind !== 'arrow') return [];
  const stroke = node.strokes?.[0];
  if (!stroke) return [];
  const weight = stroke.weight || 1;
  const strokeColor = strokePaintToSvg(node, nodeId) || 'black';
  const headSize = shape.kind === 'arrow' ? Math.max(shape.arrowheadSize, weight * 3) : weight * 3;
  const arrowStart = stroke.arrowStart ?? 'none';
  const arrowEnd = stroke.arrowEnd ?? (shape.kind === 'arrow' ? 'arrow' : 'none');
  const tags: string[] = [];
  if (arrowStart !== 'none') {
    tags.push(
      `${indent}<path d="${arrowheadSvgPath(shape.from, shape.to, headSize, arrowStart, true)}" fill="${strokeColor}"${withTransform} />`,
    );
  }
  if (arrowEnd !== 'none') {
    tags.push(
      `${indent}<path d="${arrowheadSvgPath(shape.from, shape.to, headSize, arrowEnd, false)}" fill="${strokeColor}"${withTransform} />`,
    );
  }
  return tags;
}

function pathEndpointTangent(
  points: SvgPathPoint[],
  fromStart: boolean,
): readonly [number, number] | null {
  if (points.length < 2) return null;
  const endpoint = fromStart ? points[0]! : points[points.length - 1]!;
  const neighbor = fromStart ? points[1]! : points[points.length - 2]!;
  const handle = fromStart ? endpoint.handleOut : endpoint.handleIn;
  const handleVector: readonly [number, number] = fromStart
    ? (handle ?? [0, 0])
    : ([-(handle?.[0] ?? 0), -(handle?.[1] ?? 0)] as const);
  if (Math.hypot(handleVector[0], handleVector[1]) > 0.001) return handleVector;
  const direction: readonly [number, number] = fromStart
    ? [neighbor.x - endpoint.x, neighbor.y - endpoint.y]
    : [endpoint.x - neighbor.x, endpoint.y - neighbor.y];
  if (Math.hypot(direction[0], direction[1]) > 0.001) return direction;
  for (
    let index = fromStart ? 1 : points.length - 2;
    fromStart ? index < points.length : index >= 0;
    index += fromStart ? 1 : -1
  ) {
    const candidate = points[index]!;
    const delta: readonly [number, number] = fromStart
      ? [candidate.x - endpoint.x, candidate.y - endpoint.y]
      : [endpoint.x - candidate.x, endpoint.y - candidate.y];
    if (Math.hypot(delta[0], delta[1]) > 0.001) return delta;
  }
  return null;
}

export function pathArrowheadSvgTags(
  node: SceneNode,
  nodeId: string,
  indent: string,
  withTransform: string,
): string[] {
  if (node.kind !== 'shape' || node.shape.kind !== 'path' || node.shape.closed) return [];
  const stroke = node.strokes.find((item) => item.visible);
  if (!stroke) return [];
  const start = stroke.arrowStart ?? 'none';
  const end = stroke.arrowEnd ?? 'none';
  if (start === 'none' && end === 'none') return [];
  const paint = strokePaintToSvg(node, nodeId) || 'black';
  const size = Math.max(stroke.weight * 3, 4);
  const tags: string[] = [];
  const startTangent = pathEndpointTangent(node.shape.points, true);
  if (start !== 'none' && startTangent) {
    const first = node.shape.points[0]!;
    tags.push(
      `${indent}<path d="${arrowheadSvgPath([first.x, first.y], [first.x + startTangent[0], first.y + startTangent[1]], size, start, true)}" fill="${paint}"${withTransform} />`,
    );
  }
  const endTangent = pathEndpointTangent(node.shape.points, false);
  if (end !== 'none' && endTangent) {
    const last = node.shape.points[node.shape.points.length - 1]!;
    tags.push(
      `${indent}<path d="${arrowheadSvgPath([last.x - endTangent[0], last.y - endTangent[1]], [last.x, last.y], size, end, false)}" fill="${paint}"${withTransform} />`,
    );
  }
  return tags;
}

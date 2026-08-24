import type { PathCommand, PathPoint } from '@varve/engine';
import { type Affine, applyAffine } from '@varve/shared';

export interface SelectionPathRing {
  points: PathPoint[];
  closed: boolean;
}

function transformPoint(matrix: Affine, point: { x: number; y: number }): { x: number; y: number } {
  const [x, y] = applyAffine(matrix, [point.x, point.y]);
  return { x, y };
}

function appendRing(
  commands: PathCommand[],
  points: readonly PathPoint[],
  closed: boolean,
  transform: Affine,
): void {
  if (points.length === 0) return;
  const first = points[0]!;
  const start = transformPoint(transform, first);
  commands.push({ type: 'move', x: start.x, y: start.y });

  const appendSegment = (from: PathPoint, to: PathPoint): void => {
    const end = transformPoint(transform, to);
    const control1 = from.handleOut
      ? transformPoint(transform, {
          x: from.x + from.handleOut[0],
          y: from.y + from.handleOut[1],
        })
      : null;
    const control2 = to.handleIn
      ? transformPoint(transform, {
          x: to.x + to.handleIn[0],
          y: to.y + to.handleIn[1],
        })
      : null;
    if (control1 || control2) {
      commands.push({
        type: 'curve',
        cx1: control1?.x ?? transformPoint(transform, from).x,
        cy1: control1?.y ?? transformPoint(transform, from).y,
        cx2: control2?.x ?? end.x,
        cy2: control2?.y ?? end.y,
        x: end.x,
        y: end.y,
      });
    } else {
      commands.push({ type: 'line', x: end.x, y: end.y });
    }
  };

  for (let index = 1; index < points.length; index += 1) {
    appendSegment(points[index - 1]!, points[index]!);
  }
  if (closed && points.length > 1) {
    appendSegment(points[points.length - 1]!, first);
    commands.push({ type: 'close' });
  }
}

/** Convert scene path points into document-space area-selection commands. */
export function pathPointsToSelectionCommands(
  points: readonly PathPoint[],
  closed: boolean,
  transform: Affine,
  holes: readonly (readonly PathPoint[])[] = [],
): PathCommand[] {
  const commands: PathCommand[] = [];
  appendRing(commands, points, closed, transform);
  for (const hole of holes) appendRing(commands, hole, true, transform);
  return commands;
}

/** Convert one closed area-selection contour into scene-compatible path points. */
export function selectionCommandsToPathRing(
  commands: readonly PathCommand[],
): SelectionPathRing | null {
  const points: PathPoint[] = [];
  let currentIndex = -1;
  let closed = false;

  for (const command of commands) {
    if (command.type === 'move') {
      if (currentIndex >= 0) break;
      points.push({ x: command.x, y: command.y, handleIn: null, handleOut: null });
      currentIndex = 0;
      continue;
    }
    if (currentIndex < 0) continue;
    if (command.type === 'line') {
      points.push({ x: command.x, y: command.y, handleIn: null, handleOut: null });
      currentIndex = points.length - 1;
      continue;
    }
    if (command.type === 'curve') {
      const previous = points[currentIndex]!;
      previous.handleOut = [command.cx1 - previous.x, command.cy1 - previous.y];
      points.push({
        x: command.x,
        y: command.y,
        handleIn: [command.cx2 - command.x, command.cy2 - command.y],
        handleOut: null,
      });
      currentIndex = points.length - 1;
      continue;
    }
    if (command.type === 'close') closed = true;
  }

  return points.length >= 2 ? { points, closed } : null;
}

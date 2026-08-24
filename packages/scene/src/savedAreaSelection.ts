import type { PathCommand } from '@varve/engine';
import type { NodeId } from './types';

const MAX_SAVED_SELECTIONS = 64;
const MAX_EXPRESSION_DEPTH = 64;
const MAX_EXPRESSION_NODES = 4096;
const MAX_POINTS = 100_000;
const MAX_MASK_PIXELS = 16_777_216;
const MAX_MASK_DATA_LENGTH = Math.ceil((MAX_MASK_PIXELS * 4) / 3) + 4;

export type SerializedAreaSelectionShape =
  | {
      kind: 'rectangle' | 'ellipse';
      x: number;
      y: number;
      w: number;
      h: number;
      feather: number;
      antialias: boolean;
    }
  | {
      kind: 'polygon';
      points: Array<{ x: number; y: number }>;
      feather: number;
      antialias: boolean;
    }
  | {
      kind: 'path';
      commands: PathCommand[];
      transform: [number, number, number, number, number, number];
      feather: number;
      antialias: boolean;
    }
  | {
      kind: 'raster-mask';
      x: number;
      y: number;
      w: number;
      h: number;
      width: number;
      height: number;
      data: string;
      boundary: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
      transform: [number, number, number, number, number, number];
      inverseTransform: [number, number, number, number, number, number];
      feather: number;
      antialias: boolean;
    };

export type SerializedAreaSelectionExpression =
  | { kind: 'shape'; shape: SerializedAreaSelectionShape }
  | {
      kind: 'combine';
      operation: 'add' | 'subtract' | 'intersect';
      left: SerializedAreaSelectionExpression;
      right: SerializedAreaSelectionExpression;
    };

export interface SerializedAreaSelection {
  coordinateSpace: 'document';
  expression: SerializedAreaSelectionExpression;
  generation: number;
}

/** Persistent named coverage selection. Separate from node SelectionSets. */
export interface SavedAreaSelection {
  id: string;
  name: string;
  pageId?: NodeId;
  selection: SerializedAreaSelection;
  createdAt: number;
}

export interface NormalizedSavedAreaSelections {
  selections: SavedAreaSelection[];
  dropped: number;
  changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function point(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && finite(value.x) && finite(value.y);
}

function affine(value: unknown): value is [number, number, number, number, number, number] {
  return Array.isArray(value) && value.length === 6 && value.every(finite);
}

function command(value: unknown): value is PathCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'close') return true;
  if (!finite(value.x) || !finite(value.y)) return false;
  if (value.type === 'move' || value.type === 'line') return true;
  return (
    value.type === 'curve' &&
    finite(value.cx1) &&
    finite(value.cy1) &&
    finite(value.cx2) &&
    finite(value.cy2)
  );
}

function commonShapeFields(value: Record<string, unknown>): boolean {
  return (
    finite(value.feather) &&
    value.feather >= 0 &&
    value.feather <= 4096 &&
    typeof value.antialias === 'boolean'
  );
}

function validShape(value: unknown): value is SerializedAreaSelectionShape {
  if (!isRecord(value) || typeof value.kind !== 'string' || !commonShapeFields(value)) {
    return false;
  }
  if (value.kind === 'rectangle' || value.kind === 'ellipse') {
    return (
      finite(value.x) &&
      finite(value.y) &&
      finite(value.w) &&
      finite(value.h) &&
      value.w > 0 &&
      value.h > 0
    );
  }
  if (value.kind === 'polygon') {
    return (
      Array.isArray(value.points) &&
      value.points.length >= 3 &&
      value.points.length <= MAX_POINTS &&
      value.points.every(point)
    );
  }
  if (value.kind === 'path') {
    return (
      Array.isArray(value.commands) &&
      value.commands.length > 0 &&
      value.commands.length <= MAX_POINTS &&
      value.commands.every(command) &&
      affine(value.transform)
    );
  }
  if (value.kind !== 'raster-mask') return false;
  const width = value.width;
  const height = value.height;
  return (
    finite(value.x) &&
    finite(value.y) &&
    finite(value.w) &&
    finite(value.h) &&
    value.w > 0 &&
    value.h > 0 &&
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width * height <= MAX_MASK_PIXELS &&
    typeof value.data === 'string' &&
    value.data.length <= MAX_MASK_DATA_LENGTH &&
    Array.isArray(value.boundary) &&
    value.boundary.length <= MAX_POINTS &&
    value.boundary.every((edge) => isRecord(edge) && point(edge.from) && point(edge.to)) &&
    affine(value.transform) &&
    affine(value.inverseTransform)
  );
}

function validExpression(
  value: unknown,
  depth: number,
  budget: { count: number },
): value is SerializedAreaSelectionExpression {
  if (depth > MAX_EXPRESSION_DEPTH || budget.count++ > MAX_EXPRESSION_NODES || !isRecord(value)) {
    return false;
  }
  if (value.kind === 'shape') return validShape(value.shape);
  return (
    value.kind === 'combine' &&
    (value.operation === 'add' ||
      value.operation === 'subtract' ||
      value.operation === 'intersect') &&
    validExpression(value.left, depth + 1, budget) &&
    validExpression(value.right, depth + 1, budget)
  );
}

function validSelection(value: unknown): value is SerializedAreaSelection {
  if (!isRecord(value) || value.coordinateSpace !== 'document' || !finite(value.generation)) {
    return false;
  }
  return validExpression(value.expression, 0, { count: 0 });
}

/** Validate untrusted persisted named selections without decoding raster bytes. */
export function normalizeSavedAreaSelections(value: unknown): NormalizedSavedAreaSelections {
  if (!Array.isArray(value)) return { selections: [], dropped: 0, changed: value !== undefined };
  const selections: SavedAreaSelection[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const raw of value.slice(0, MAX_SAVED_SELECTIONS)) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      raw.id.length === 0 ||
      raw.id.length > 256 ||
      ids.has(raw.id) ||
      typeof raw.name !== 'string' ||
      raw.name.length === 0 ||
      raw.name.length > 256 ||
      (raw.pageId !== undefined && typeof raw.pageId !== 'string') ||
      !finite(raw.createdAt) ||
      !validSelection(raw.selection)
    ) {
      dropped++;
      continue;
    }
    ids.add(raw.id);
    selections.push({
      id: raw.id,
      name: raw.name,
      ...(raw.pageId !== undefined ? { pageId: raw.pageId } : {}),
      selection: raw.selection,
      createdAt: Math.max(0, raw.createdAt),
    });
  }
  if (value.length > MAX_SAVED_SELECTIONS) dropped += value.length - MAX_SAVED_SELECTIONS;
  return { selections, dropped, changed: dropped > 0 || selections.length !== value.length };
}

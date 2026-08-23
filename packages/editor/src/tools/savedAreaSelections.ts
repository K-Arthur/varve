import type { AreaSelection, AreaSelectionExpression, AreaSelectionShape } from '@varve/engine';
import type {
  SavedAreaSelection,
  SerializedAreaSelection,
  SerializedAreaSelectionExpression,
  SerializedAreaSelectionShape,
} from '@varve/scene';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    const end = Math.min(bytes.length, index + 0x8000);
    for (let cursor = index; cursor < end; cursor += 1) binary += String.fromCharCode(bytes[cursor]!);
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

function base64ToBytes(value: string): Uint8Array | null {
  if (typeof atob !== 'function') return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function serializeShape(shape: AreaSelectionShape): SerializedAreaSelectionShape {
  if (shape.kind !== 'raster-mask') return { ...shape } as SerializedAreaSelectionShape;
  return { ...shape, data: bytesToBase64(shape.data) };
}

function serializeExpression(
  expression: AreaSelectionExpression,
): SerializedAreaSelectionExpression {
  if (expression.kind === 'shape') return { kind: 'shape', shape: serializeShape(expression.shape) };
  return {
    kind: 'combine',
    operation: expression.operation,
    left: serializeExpression(expression.left),
    right: serializeExpression(expression.right),
  };
}

export function serializeAreaSelection(selection: AreaSelection): SerializedAreaSelection {
  return {
    coordinateSpace: 'document',
    generation: selection.generation,
    expression: serializeExpression(selection.expression),
  };
}

function deserializeShape(shape: SerializedAreaSelectionShape): AreaSelectionShape | null {
  if (shape.kind !== 'raster-mask') return { ...shape } as AreaSelectionShape;
  const data = base64ToBytes(shape.data);
  if (!data || data.length !== shape.width * shape.height) return null;
  return { ...shape, data };
}

function deserializeExpression(
  expression: SerializedAreaSelectionExpression,
): AreaSelectionExpression | null {
  if (expression.kind === 'shape') {
    const shape = deserializeShape(expression.shape);
    return shape ? { kind: 'shape', shape } : null;
  }
  const left = deserializeExpression(expression.left);
  const right = deserializeExpression(expression.right);
  return left && right
    ? { kind: 'combine', operation: expression.operation, left, right }
    : null;
}

export function deserializeAreaSelection(saved: SavedAreaSelection): AreaSelection | null {
  const expression = deserializeExpression(saved.selection.expression);
  if (!expression || saved.selection.coordinateSpace !== 'document') return null;
  return {
    coordinateSpace: 'document',
    expression,
    generation: Math.max(0, saved.selection.generation),
  };
}

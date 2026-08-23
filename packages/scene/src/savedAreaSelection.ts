import type { PathCommand } from '@varve/engine';
import type { NodeId } from './types';

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

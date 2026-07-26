import type { Affine, Document, Point, Rect } from '@strata/scene';

export type AuditSeverity = 'error' | 'warning' | 'suggestion' | 'advisory';

export interface OverlayStyle {
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  fillOpacity?: number;
  dashPattern?: number[];
  opacity?: number;
}

export type OverlayPrimitive =
  | { kind: 'rect'; bounds: Rect; style: OverlayStyle; findingId: string }
  | { kind: 'path'; data: Point[]; closed: boolean; style: OverlayStyle; findingId: string }
  | { kind: 'point'; at: Point; style: OverlayStyle; findingId: string }
  | {
      kind: 'badge';
      anchor: Point;
      text: string;
      severity: AuditSeverity;
      findingId: string;
      screenSpaceSize: true;
    };

export interface OverlayContext {
  document: Document;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  viewport: { width: number; height: number };
  getWorldBounds: (nodeId: string) => Rect | null;
  getWorldTransform: (nodeId: string) => Affine;
  hiddenNodeIds: Set<string>;
  clippedNodeIds: Set<string>;
}

export interface OverlayProvider {
  id: string;
  label: string;
  getPrimitives(ctx: OverlayContext): OverlayPrimitive[];
  interactive?: boolean;
  zOrder: number;
  enabled: boolean;
}

export interface OverlayToggleState {
  masterEnabled: boolean;
  providerOverrides: Record<string, boolean | undefined>;
  severityFilter: AuditSeverity[];
}

export const DEFAULT_OVERLAY_TOGGLE_STATE: OverlayToggleState = {
  masterEnabled: false,
  providerOverrides: {},
  severityFilter: ['error', 'warning', 'suggestion', 'advisory'],
};

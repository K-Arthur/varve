/**
 * Shared types for the codegen emitter system.
 *
 * Kept in a separate module so emitters can import them without
 * creating a circular dependency through index.ts.
 */

import type { Document, SceneNode } from '@varve/scene';

/** A feature that a node uses which the target format cannot represent faithfully. */
export interface TargetGap {
  nodeId: string;
  nodeName: string;
  feature: string;
  severity: 'warning' | 'error' | 'info';
  fallback?: string;
}

/**
 * A pre-rasterized image asset for embedding in vector export formats
 * (SVG, PDF) when the original node uses effects that cannot be
 * represented natively.  Created by the export-flattening pipeline in
 * `@varve/editor` and consumed by codegen.
 *
 * The dataUrl is a base64-encoded PNG that the codegen emitter embeds
 * as an `<image>` element (SVG) or an Image XObject (PDF).  The
 * `pixelWidth`/`pixelHeight` and `cssWidth`/`cssHeight` fields allow
 * the emitter to set the correct output dimensions regardless of the
 * export scale factor.
 */
export interface RasterAsset {
  nodeId: string;
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  cssWidth: number;
  cssHeight: number;
  dpi?: number;
  /**
   * Effect expansion in CSS/document units: effects that generate pixels
   * outside the source bounds (bloom, flares, RGB displacement) render on a
   * padded surface. The PNG therefore contains `cssWidth + left + right` ×
   * `cssHeight + top + bottom` CSS units of content, with the source content
   * anchored at `(left, top)` inside the image. Emitters must place the
   * image at `x = -left, y = -top` with the expanded size; absent this field
   * the image contains exactly `cssWidth` × `cssHeight` units anchored at
   * the origin (legacy behaviour).
   */
  expansion?: { left: number; top: number; right: number; bottom: number };
}

/**
 * A code emitter — wraps a single export function with a companion
 * `targetGaps()` that reports unsupported features for a given node.
 */
export interface CodeEmitter<O = unknown> {
  format: string;
  emit(node: SceneNode, doc: Document, opts?: O): string;
  targetGaps(node: SceneNode, doc: Document): TargetGap[];
}

/**
 * Additional metadata that codegen emitters can use to decide how to
 * render a node.  Passed alongside the document during export.
 */
export interface ExportMetadata {
  /** Pre-rasterized image assets keyed by node ID. */
  rasterAssets?: Record<string, RasterAsset>;
}

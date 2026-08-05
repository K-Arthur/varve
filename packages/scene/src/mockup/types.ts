/**
 * Mockup system persistent types (schema 2.16+).
 *
 * A mockup is a FrameNode carrying a `mockup` payload that references a
 * template asset (`Document.mockupTemplates`) and binds document content to
 * the template's replaceable surfaces. Templates are self-contained:
 * geometry, plate shapes, overlays, and licensing live in the document, so
 * save/reopen and offline use never depend on a library lookup.
 *
 * Level contract (see docs/architecture/mockup-system.md):
 * - Level 1 flat surfaces: `kind: 'flat'` with affine placement.
 * - Level 2 perspective surfaces: `kind: 'quad'` with four-corner mapping.
 * - Level 3/4 kinds ('mesh', 'cylindrical') and raster mask assets are
 *   reserved; validation rejects them until implemented.
 */

import type { NodeId } from '../types';

export type MockupCategory =
  | 'devices'
  | 'browser-desktop'
  | 'print'
  | 'stationery'
  | 'packaging'
  | 'apparel'
  | 'signage'
  | 'social-marketing'
  | 'logo';

export type MockupTemplateSource = 'builtin' | 'user' | 'workspace' | 'community';

export type MockupOrientation = 'portrait' | 'landscape' | 'square' | 'any';

/** Level 1-2 surface kinds; 'mesh'/'cylindrical' reserved for Level 3. */
export type MockupSurfaceKind = 'flat' | 'quad' | 'mesh' | 'cylindrical';

export type MockupFitMode = 'contain' | 'cover' | 'stretch' | 'native';

export type MockupAlign = 'min' | 'center' | 'max';

export type MockupBindingMode = 'live' | 'snapshot';

export interface MockupVec2 {
  x: number;
  y: number;
}

/** Four corners; winding is normalized at render time. */
export type MockupQuad = [MockupVec2, MockupVec2, MockupVec2, MockupVec2];

/** Licensing snapshot attached to a template. Unknown values stay unknown. */
export interface MockupLicenceSnapshot {
  title: string;
  spdx?: string;
  url?: string;
  creator: string;
  attribution?: string;
  commercialUse?: 'yes' | 'no' | 'unknown';
  modification?: 'yes' | 'no' | 'unknown';
  redistribution?: 'yes' | 'no' | 'unknown';
  trademarkWarning?: string;
  retrievedAt?: number;
}

/**
 * A drawable template shape. Coordinates depend on the surface kind:
 * - flat surface plates: template output coordinates (absolute).
 * - quad surface plates: slot-local coordinates (0,0 = slot top-left).
 */
export type MockupVectorShape =
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
      rotation?: number;
      fill: string;
      opacity?: number;
    }
  | {
      kind: 'ellipse';
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      opacity?: number;
    };

export interface MockupSurfaceShadow {
  /** Shadow blur in template px (0 disables). */
  blur: number;
  offsetX?: number;
  offsetY: number;
  opacity: number;
}

export interface MockupSurfaceDefinition {
  /** Unique within the template. */
  id: string;
  name: string;
  kind: MockupSurfaceKind;
  /** Semantic slot: 'screen', 'front', 'back', 'cover', 'label', ... */
  sourceSlot: string;
  /** Slot rect in template output coordinates (flat geometry). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Perspective geometry; required when kind === 'quad'. */
  quad?: MockupQuad;
  fit: MockupFitMode;
  alignment: { x: MockupAlign; y: MockupAlign };
  /**
   * Plate shapes drawn behind the source content. For flat surfaces these
   * are template-output-absolute; for quad surfaces they are slot-local and
   * are warped together with the content (device body, bezel).
   */
  plate?: MockupVectorShape[];
  /**
   * For quad surfaces with a plate: how far the plate extends beyond the
   * slot rect (slot-local px), so the warp region covers the whole device.
   */
  platePadding?: { x: number; y: number };
  shadow?: MockupSurfaceShadow;
  /** Soft emissive glow over the content (screens). */
  screenGlow?: boolean;
  /** Dark bezel variant. */
  dark?: boolean;
  /** Reserved (Level 3/4): raster masks and displacement. */
  clipMaskAssetId?: string;
  occlusionMaskAssetId?: string;
  displacementAssetId?: string;
}

export interface MockupOverlayDefinition {
  id: string;
  name: string;
  kind: 'shadow' | 'highlight' | 'reflection' | 'vignette' | 'grain';
  opacity: number;
  blendMode?: string;
  shapes: MockupVectorShape[];
}

/** Persistent template asset embedded in the document (self-contained). */
export interface MockupTemplateAsset {
  /** Stable id, e.g. 'builtin:phone-flat' or a user-generated id. */
  id: string;
  schemaVersion: number;
  name: string;
  description?: string;
  category: MockupCategory;
  source: MockupTemplateSource;
  orientation: MockupOrientation;
  /** Template design space, px. */
  outputWidth: number;
  outputHeight: number;
  /** CSS color behind everything, or 'transparent'. */
  backgroundColor: string;
  /** Full-bleed background shapes (output coordinates). */
  plate: MockupVectorShape[];
  surfaces: MockupSurfaceDefinition[];
  overlays: MockupOverlayDefinition[];
  licence?: MockupLicenceSnapshot;
  tags?: string[];
  contentHash: string;
  capabilities?: string[];
  minVarveVersion?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** How a surface gets its content. */
export interface MockupSourceBinding {
  mode: MockupBindingMode;
  /** Live document link: the frame/group being presented. */
  nodeId?: NodeId;
  /** Embedded snapshot: a Document.assets raster of the captured content. */
  assetId?: string;
  capturedWidth?: number;
  capturedHeight?: number;
}

/** Per-surface instance overrides on top of the template definition. */
export interface MockupSurfaceOverride {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  quad?: MockupQuad;
  fit?: MockupFitMode;
  alignment?: { x: MockupAlign; y: MockupAlign };
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  shadow?: MockupSurfaceShadow | null;
  screenGlow?: boolean;
}

/** FrameNode.mockup payload. */
export interface MockupInstanceData {
  templateId: string;
  surfaceBindings: Record<string, MockupSourceBinding>;
  overrides?: Record<string, MockupSurfaceOverride>;
  /** True once the instance's content has been flattened to editable nodes. */
  detached?: boolean;
  createdAt?: number;
}

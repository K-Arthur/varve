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
   * Optional placement for a raster fallback rendered in world coordinates.
   * The transform is relative to the boundary node's emitted parent and
   * replaces that node's transform when embedding the pre-rendered image.
   */
  placementTransform?: readonly [number, number, number, number, number, number];
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

/** Language of a generated file, used for highlighting and verification. */
export type GeneratedFileLanguage =
  | 'tsx'
  | 'ts'
  | 'jsx'
  | 'js'
  | 'css'
  | 'html'
  | 'svg'
  | 'json'
  | 'dart'
  | 'swift'
  | 'vue'
  | 'svelte'
  | 'text';

/**
 * One physical file in a generated bundle.
 *
 * A code export is not always one string. React + CSS Modules is two files,
 * a page target is a document plus a stylesheet, and an asset target is an
 * image. Representing that explicitly is what lets the UI show a file tree,
 * the download write real paths, and a verifier compile the real contract
 * instead of a concatenated string that only looks like code.
 */
export interface GeneratedFile {
  /** POSIX-style relative path inside the exported unit (no leading slash). */
  path: string;
  language: GeneratedFileLanguage;
  mimeType: string;
  contents: string;
  /** The file a consumer opens or runs first. Exactly one per bundle. */
  entry?: boolean;
}

/**
 * What a bundle actually is. A snippet is not a page, and a component with
 * dependencies is not a standalone project. The label is shown to the user
 * and drives the handoff instructions.
 */
export type CodeDeliverableKind = 'snippet' | 'component' | 'project' | 'asset' | 'prototype';

/** A structured, node-attributable problem discovered while generating. */
export interface BundleDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
  nodeName?: string;
  /** Feature or primitive that could not be represented faithfully. */
  feature?: string;
}

/**
 * The canonical result of a code-generation run: an explicit set of files
 * plus the dependency and diagnostic information a developer needs to build
 * them. Emitters keep their convenient string APIs as adapters over this.
 */
export interface GeneratedBundle {
  /** Target identifier, e.g. `react-cssmodules`. */
  target: string;
  deliverable: CodeDeliverableKind;
  files: GeneratedFile[];
  /**
   * Runtime/build dependencies the consumer must provide, as
   * `packageName -> semver range`. Never invented: an entry here means the
   * generated file imports it.
   */
  dependencies: Record<string, string>;
  /** Ordered developer handoff steps, e.g. the import line to add. */
  setup?: string[];
  diagnostics: BundleDiagnostic[];
}

/** MIME type for a generated file language. */
export function mimeTypeForLanguage(language: GeneratedFileLanguage): string {
  switch (language) {
    case 'tsx':
    case 'jsx':
      return 'text/jsx';
    case 'ts':
      return 'text/typescript';
    case 'js':
      return 'text/javascript';
    case 'css':
      return 'text/css';
    case 'html':
      return 'text/html';
    case 'svg':
      return 'image/svg+xml';
    case 'json':
      return 'application/json';
    case 'dart':
      return 'text/x-dart';
    case 'swift':
      return 'text/x-swift';
    case 'vue':
      return 'text/x-vue';
    case 'svelte':
      return 'text/x-svelte';
    default:
      return 'text/plain';
  }
}

/** The entry file of a bundle, or the first file when none is marked. */
export function bundleEntryFile(bundle: GeneratedBundle): GeneratedFile | undefined {
  return bundle.files.find((file) => file.entry) ?? bundle.files[0];
}

/** Find a file by its relative path. */
export function bundleFile(bundle: GeneratedBundle, path: string): GeneratedFile | undefined {
  return bundle.files.find((file) => file.path === path);
}

/**
 * @varve/codegen — Scene → code export (Strata plan §3.3, task 0.10).
 *
 * Exports the scene model to CSS, React+Tailwind, React+CSS-Modules,
 * SVG, Flutter, and SwiftUI output. All exports are local-only:
 * zero network round-trips.
 */

import type { Affine } from '@varve/engine';
import type { Document, ManagedColor, Mask, NodeId, SceneNode, VectorMaskData } from '@varve/scene';
import { activePageNodes, isImageShape, resolveMask } from '@varve/scene';
import { applyAffine, managedColorToRgba, multiplyAffine } from '@varve/shared';
import { resolveLiveBooleanForExport } from './liveBooleanExport';
import { buildPerspectiveImageSvg } from './perspectiveSvg';
import { nodeEffectiveTransform, svgCompositing } from './shared';
import {
  collectPathTextDefs,
  imageContentTransform,
  imagePlacementForShape,
  pathTextSvgContent,
  pathTextSvgDef,
  pathTextSvgId,
  svgRect,
} from './svg';
import { exportShapeOf } from './warpBake';

export { timelineToCSSKeyframes } from './animation-css';
export type { InteractiveExportOptions, InteractiveExportResult } from './animation-interactive';
export { exportInteractiveAnimations, exportInteractivePrototype } from './animation-interactive';
export { timelineToLottieJSON } from './animation-lottie';
export { timelineToSVGAnimations } from './animation-svg';
export { cssTargetGaps, exportNodeToCss } from './css';
export { cssModulesTargetGaps, exportNodeToCssModules } from './css-modules';
export type { DesignAuditOptions } from './design-audit';
export { runCodegenReadiness, runDesignAudit } from './design-audit';
export type { EmailCompileOptions, EmailCompileResult } from './email-compiler';
export { compileEmail } from './email-compiler';
export type { EmailCssInlineResult } from './email-css';
export { inlineEmailCss } from './email-css';
export type { EmailHtmlExportOptions, EmailHtmlExportResult } from './email-html';
export { emitEmailHtml } from './email-html';
export * from './email-ir-types';
export { emitEmailPlainText } from './email-plain-text';
export { runEmailPreflight } from './email-preflight';
export type { EmailProviderAdapter } from './email-provider';
export {
  genericEmailProvider,
  getEmailProviderAdapter,
  mailchimpEmailProvider,
} from './email-provider';
export type { EmailHtmlSanitizeOptions } from './email-security';
export {
  appendTrackingParams,
  sanitizeEmailCss,
  sanitizeEmailHtml,
  validateEmailUrl,
} from './email-security';
export type {
  EmitStrategy,
  FlattenedNodeSpec,
  FlatteningAnalysis,
  FlattenReason,
  RenderCapability,
} from './flattening';
export {
  analyzeFlattening,
  analyzeNodeFlattening,
  blendModeToCss,
  canEmitAsHtml,
  getEmitTag,
  getRenderCapability,
} from './flattening';
export { exportNodeToFlutter, flutterTargetGaps } from './flutter';
export type { HtmlExportOptions } from './html';
export { exportIrToHtml } from './html';
export { deserializeIR, sceneToIR, serializeIR } from './ir-converter';
export type { AuditCategory, AuditFinding, DesignAuditReport } from './ir-types';
export * from './ir-types';
export type { OptContext, OptimizationResult } from './optimizers';
export { optimizeCode } from './optimizers';
export type { RasterAuditFinding, RasterIssueType } from './raster-audit';
export { runRasterAudit } from './raster-audit';
export * from './shared';
export * from './spec';
export { exportNodeToSvelte, type SvelteExportOptions, svelteTargetGaps } from './svelte';
export { exportNodeToSvg, svgTargetGaps } from './svg';
export { exportNodeToSwiftUI, swiftuiTargetGaps } from './swiftui';
export {
  exportIrNodeToTailwind,
  exportIrToTailwind,
  exportNodeToTailwind,
  sceneToTailwind,
  tailwindTargetGaps,
} from './tailwind';
export * from './target-analysis';
export { resolveTokenName } from './tokens';
export type { CodeEmitter, ExportMetadata, RasterAsset, TargetGap } from './types';
export type { VectorAuditFinding, VectorIssueType } from './vector-audit';
export { runVectorAudit } from './vector-audit';
export { exportNodeToVue, type VueExportOptions, vueTargetGaps } from './vue';
export {
  type BakedWarp,
  bakeWarpedShape,
  EXPORT_WARP_QUALITY,
  exportShapeOf,
  nodeHasLiveWarp,
  unbakeableWarpKind,
  warpRequiresFlattening,
} from './warpBake';
export {
  exportNodeToWebComponent,
  type WebComponentExportOptions,
  webComponentTargetGaps,
} from './web-component';

export const PACKAGE = '@varve/codegen' as const;

export interface SvgExportOptions {
  precision?: number;
  minify?: boolean;
  includeHidden?: boolean;
  styleMode?: 'inline' | 'presentation';
  /**
   * Pre-rasterized image assets for nodes that use effects which
   * vector formats cannot represent natively.
   */
  rasterAssets?: Record<string, import('./types').RasterAsset>;
}

function rgba(c: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(c);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function affineToSvg(t: Affine): string {
  return `matrix(${t[0]},${t[1]},${t[2]},${t[3]},${t[4]},${t[5]})`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number, precision: number): string {
  return precision < 10 ? Number(n.toFixed(precision)).toString() : n.toString();
}

function shapeVerticesToPoints(
  s: { kind: string } & Record<string, unknown>,
  precision: number,
): string {
  if (s.kind === 'polygon') {
    const cx = Number(s.cx),
      cy = Number(s.cy),
      radius = Number(s.radius);
    const sides = Number(s.sides),
      rotation = Number(s.rotation);
    const pts: string[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides - Math.PI / 2 + rotation;
      pts.push(
        `${fmtNum(cx + radius * Math.cos(a), precision)},${fmtNum(cy + radius * Math.sin(a), precision)}`,
      );
    }
    return pts.join(' ');
  }
  if (s.kind === 'star') {
    const cx = Number(s.cx),
      cy = Number(s.cy),
      ir = Number(s.innerRadius),
      or = Number(s.outerRadius);
    const points = Number(s.points),
      rotation = Number(s.rotation);
    const pts: string[] = [];
    for (let i = 0; i < points * 2; i++) {
      const a = (Math.PI * i) / points - Math.PI / 2 + rotation;
      const r = i % 2 === 0 ? or : ir;
      pts.push(
        `${fmtNum(cx + r * Math.cos(a), precision)},${fmtNum(cy + r * Math.sin(a), precision)}`,
      );
    }
    return pts.join(' ');
  }
  return '';
}

function shapePathToData(
  shape: Extract<import('@varve/engine').Shape, { kind: 'path' }>,
  precision: number,
): string {
  const ringToCommands = (points: import('@varve/engine').PathPoint[], closed: boolean) => {
    const first = points[0];
    if (!first) return [];
    const commands = [`M ${fmtNum(first.x, precision)} ${fmtNum(first.y, precision)}`];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1] as import('@varve/engine').PathPoint;
      const current = points[index] as import('@varve/engine').PathPoint;
      if (previous.handleOut || current.handleIn) {
        const c1x = previous.x + (previous.handleOut?.[0] ?? 0);
        const c1y = previous.y + (previous.handleOut?.[1] ?? 0);
        const c2x = current.x + (current.handleIn?.[0] ?? 0);
        const c2y = current.y + (current.handleIn?.[1] ?? 0);
        commands.push(
          `C ${fmtNum(c1x, precision)} ${fmtNum(c1y, precision)} ${fmtNum(c2x, precision)} ${fmtNum(c2y, precision)} ${fmtNum(current.x, precision)} ${fmtNum(current.y, precision)}`,
        );
      } else {
        commands.push(`L ${fmtNum(current.x, precision)} ${fmtNum(current.y, precision)}`);
      }
    }
    if (closed) commands.push('Z');
    return commands;
  };

  const commands = ringToCommands(shape.points, shape.closed);
  for (const hole of shape.holes ?? []) {
    commands.push(...ringToCommands(hole, true));
  }
  return commands.join(' ');
}

/**
 * Compute the bounding box of all root-level nodes in a document.
 */
function documentNodeBounds(
  node: SceneNode,
  doc: Document,
  parentTransform: Affine = [1, 0, 0, 1, 0, 0],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const transform = multiplyAffine(parentTransform, nodeEffectiveTransform(node));
  if (node.kind === 'group' && node.boolean) {
    const resolved = resolveLiveBooleanForExport(node, doc);
    return resolved ? documentNodeBounds(resolved, doc, parentTransform) : null;
  }
  if (node.kind === 'group' || node.kind === 'frame') {
    const mask = resolveMask(node, doc);
    const children = node.children
      .filter((id) => !(mask?.hideMaskSource && mask.sourceNodeId === id))
      .map((id) => doc.nodes[id])
      .filter((child): child is SceneNode => child?.visible === true)
      .map((child) => documentNodeBounds(child, doc, transform))
      .filter((bounds): bounds is NonNullable<typeof bounds> => bounds !== null);
    if (children.length > 0) {
      const contentBounds = {
        minX: Math.min(...children.map((bounds) => bounds.minX)),
        minY: Math.min(...children.map((bounds) => bounds.minY)),
        maxX: Math.max(...children.map((bounds) => bounds.maxX)),
        maxY: Math.max(...children.map((bounds) => bounds.maxY)),
      };
      if (mask?.type === 'clip' && !mask.inverted && mask.sourceNodeId) {
        const source = doc.nodes[mask.sourceNodeId];
        const maskBounds = source ? documentNodeBounds(source, doc, transform) : null;
        if (maskBounds) {
          const clippedBounds = {
            minX: Math.max(contentBounds.minX, maskBounds.minX),
            minY: Math.max(contentBounds.minY, maskBounds.minY),
            maxX: Math.min(contentBounds.maxX, maskBounds.maxX),
            maxY: Math.min(contentBounds.maxY, maskBounds.maxY),
          };
          return clippedBounds.maxX >= clippedBounds.minX &&
            clippedBounds.maxY >= clippedBounds.minY
            ? clippedBounds
            : null;
        }
      }
      return contentBounds;
    }
  }

  let x = 0;
  let y = 0;
  let width = 100;
  let height = 100;
  if (node.kind === 'shape') {
    // Bake first: warped geometry routinely extends past the source box, and
    // measuring the source would crop it out of the document viewBox.
    const shape = exportShapeOf(node, doc);
    switch (shape.kind) {
      case 'rect':
        ({ x, y, w: width, h: height } = shape);
        break;
      case 'ellipse':
        x = shape.cx - shape.rx;
        y = shape.cy - shape.ry;
        width = shape.rx * 2;
        height = shape.ry * 2;
        break;
      case 'circle':
        x = shape.cx - shape.r;
        y = shape.cy - shape.r;
        width = shape.r * 2;
        height = shape.r * 2;
        break;
      case 'line':
      case 'arrow':
        x = Math.min(shape.from[0], shape.to[0]);
        y = Math.min(shape.from[1], shape.to[1]);
        width = Math.max(1, Math.abs(shape.to[0] - shape.from[0]));
        height = Math.max(1, Math.abs(shape.to[1] - shape.from[1]));
        break;
      case 'polygon':
        x = shape.cx - shape.radius;
        y = shape.cy - shape.radius;
        width = shape.radius * 2;
        height = shape.radius * 2;
        break;
      case 'star':
        x = shape.cx - shape.outerRadius;
        y = shape.cy - shape.outerRadius;
        width = shape.outerRadius * 2;
        height = shape.outerRadius * 2;
        break;
      case 'path': {
        if (shape.points.length === 0) break;
        const xs = shape.points.flatMap((point) => [
          point.x,
          point.x + (point.handleIn?.[0] ?? 0),
          point.x + (point.handleOut?.[0] ?? 0),
        ]);
        const ys = shape.points.flatMap((point) => [
          point.y,
          point.y + (point.handleIn?.[1] ?? 0),
          point.y + (point.handleOut?.[1] ?? 0),
        ]);
        x = Math.min(...xs);
        y = Math.min(...ys);
        width = Math.max(1, Math.max(...xs) - x);
        height = Math.max(1, Math.max(...ys) - y);
        break;
      }
    }
  } else if (node.kind === 'text') {
    width = Math.max(1, node.text.length * node.fontSize * 0.6);
    height = Math.max(1, node.fontSize * 1.2);
  } else if (node.kind === 'path') {
    if (node.points.length > 0) {
      const xs = node.points.map((point) => point.x);
      const ys = node.points.map((point) => point.y);
      x = Math.min(...xs);
      y = Math.min(...ys);
      width = Math.max(1, Math.max(...xs) - x);
      height = Math.max(1, Math.max(...ys) - y);
    }
  } else if (node.kind === 'frame') {
    width = 200;
    height = 200;
  }

  const corners = [
    applyAffine(transform, [x, y]),
    applyAffine(transform, [x + width, y]),
    applyAffine(transform, [x + width, y + height]),
    applyAffine(transform, [x, y + height]),
  ];
  return {
    minX: Math.min(...corners.map((point) => point[0])),
    minY: Math.min(...corners.map((point) => point[1])),
    maxX: Math.max(...corners.map((point) => point[0])),
    maxY: Math.max(...corners.map((point) => point[1])),
  };
}

/** Resolve current page artwork plus legacy flat root nodes without duplicates. */
function documentExportRootIds(doc: Document): NodeId[] {
  const contentRoots = new Set(doc.pages?.map((page) => page.contentRoot) ?? []);
  return [
    ...new Set([
      ...activePageNodes(doc),
      ...doc.rootChildren.filter((id) => !contentRoots.has(id)),
    ]),
  ];
}

export function computeDocumentBounds(doc: Document): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let hasNodes = false;
  for (const id of documentExportRootIds(doc)) {
    const node = doc.nodes[id];
    if (!node?.visible) continue;
    const bounds = documentNodeBounds(node, doc);
    if (!bounds) continue;
    hasNodes = true;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  if (!hasNodes) return { x: 0, y: 0, w: doc.canvasWidth ?? 1920, h: doc.canvasHeight ?? 1080 };

  const padX = 20;
  const x = Math.round(minX - padX);
  const y = Math.round(minY - padX);
  const w = Math.round(maxX - minX + padX * 2);
  const h = Math.round(maxY - minY + padX * 2);
  return { x: Math.max(0, x), y: Math.max(0, y), w: Math.max(1, w), h: Math.max(1, h) };
}

/** Minimal vector-mask SVG path data for document-level mask defs. */
function docVectorMaskToPathData(vm: VectorMaskData): string {
  const pts = vm.points;
  if (pts.length === 0) return '';
  const first = pts[0]!;
  const cmds: string[] = [`M ${first.x} ${first.y}`];
  for (let i = 1; i < pts.length; i += 1) {
    const prev = pts[i - 1]!;
    const curr = pts[i]!;
    if (prev.handleOut || curr.handleIn) {
      const c1x = prev.x + (prev.handleOut?.[0] ?? 0);
      const c1y = prev.y + (prev.handleOut?.[1] ?? 0);
      const c2x = curr.x + (curr.handleIn?.[0] ?? 0);
      const c2y = curr.y + (curr.handleIn?.[1] ?? 0);
      cmds.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${curr.x} ${curr.y}`);
    } else {
      cmds.push(`L ${curr.x} ${curr.y}`);
    }
  }
  if (vm.closed) cmds.push('Z');
  return cmds.join(' ');
}

/** Build a single mask def element for document-level export. */
function docBuildMaskDef(doc: Document, containerId: string, mask: Mask): string | null {
  if (mask.visible === false) return null;
  const maskId = `mask-${containerId}`;
  const lines: string[] = [];

  // Raster mask: embedded alpha image from rasterMaskAssets.
  if (mask.type === 'alpha' && 'rasterMask' in mask && mask.rasterMask) {
    const assetId = mask.rasterMask.assetId;
    const asset =
      doc.rasterMaskAssets && Object.hasOwn(doc.rasterMaskAssets, assetId)
        ? doc.rasterMaskAssets[assetId]
        : undefined;
    if (asset?.dataUrl) {
      const container = doc.nodes[containerId];
      // Container-local painted masks (frames): the asset stretches over the
      // frame's local box under the frame element's own transform, matching
      // the live-canvas semantics (maskContentUnits = userSpaceOnUse).
      if (container?.kind === 'frame') {
        const fw = container.w ?? 1;
        const fh = container.h ?? 1;
        lines.push(
          `    <mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${fw}" height="${fh}" style="mask-type: alpha">`,
        );
        lines.push(
          `      <image href="${escapeXml(asset.dataUrl)}" x="0" y="0" width="${fw}" height="${fh}" preserveAspectRatio="none" />`,
        );
        lines.push(`    </mask>`);
        return lines.join('\n');
      }
      const imageFill =
        container?.kind === 'shape'
          ? container.fills?.find((fill) => fill.type === 'image' && fill.image)?.image
          : undefined;
      const placement =
        container?.kind === 'shape' && imageFill
          ? imagePlacementForShape(container, imageFill, {
              width: asset.width,
              height: asset.height,
            })
          : null;
      if (placement && imageFill) {
        const bounds = placement.bounds;
        const contentTransform = imageContentTransform(placement);
        const transformAttr = contentTransform ? ` transform="${contentTransform}"` : '';
        const cropClipId = `${maskId}-crop`;
        lines.push(
          `    <mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" style="mask-type: alpha">`,
        );
        if (imageFill.crop) {
          lines.push(
            `      <clipPath id="${cropClipId}" clipPathUnits="userSpaceOnUse"><rect ${svgRect(placement.sampleDrawRect)} /></clipPath>`,
          );
        }
        lines.push(
          `      <g${transformAttr}${imageFill.crop ? ` clip-path="url(#${cropClipId})"` : ''}>`,
        );
        lines.push(
          `        <image href="${escapeXml(asset.dataUrl)}" ${svgRect(placement.drawRect)} preserveAspectRatio="none" />`,
        );
        lines.push(`      </g>`);
        lines.push(`    </mask>`);
        return lines.join('\n');
      }
      lines.push(`    <mask id="${maskId}" style="mask-type: alpha">`);
      lines.push(
        `      <image href="${escapeXml(asset.dataUrl)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" />`,
      );
      lines.push(`    </mask>`);
      return lines.join('\n');
    }
    return null;
  }

  const hasVectorMask = mask.vectorMask && mask.vectorMask.points.length > 0;
  const hasSourceNode = mask.sourceNodeId && doc.nodes[mask.sourceNodeId];

  if (!hasVectorMask && !hasSourceNode) return null;

  if (hasVectorMask) {
    const d = docVectorMaskToPathData(mask.vectorMask!);
    if (!d) return null;
    if (mask.type === 'clip') {
      if (mask.inverted) {
        lines.push(`    <mask id="${maskId}">`);
        lines.push(`      <rect width="100%" height="100%" fill="white" />`);
        lines.push(`      <path d="${d}" fill="black" />`);
        lines.push(`    </mask>`);
      } else {
        const fillRuleAttr = mask.fillRule === 'evenodd' ? ` clip-rule="evenodd"` : '';
        const unitsAttr = mask.linked === false ? ` clipPathUnits="userSpaceOnUse"` : '';
        lines.push(`    <clipPath id="${maskId}"${fillRuleAttr}${unitsAttr}>`);
        lines.push(`      <path d="${d}" />`);
        lines.push(`    </clipPath>`);
      }
    } else {
      const maskTypeAttr = mask.type === 'luminance' ? ` mask-type="luminance"` : '';
      const unitsAttr =
        mask.linked === false
          ? ` maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"`
          : '';
      let filterAttr = '';
      if (mask.feather && mask.feather > 0) {
        const filterId = `${maskId}-filter`;
        lines.push(`    <filter id="${filterId}">`);
        lines.push(`      <feGaussianBlur stdDeviation="${mask.feather}" />`);
        lines.push(`    </filter>`);
        filterAttr = ` filter="url(#${filterId})"`;
      }
      lines.push(`    <mask id="${maskId}"${maskTypeAttr}${filterAttr}${unitsAttr}>`);
      if (mask.inverted) {
        lines.push(`      <rect width="100%" height="100%" fill="white" />`);
        lines.push(`      <path d="${d}" fill="black" />`);
      } else {
        lines.push(`      <rect width="100%" height="100%" fill="black" />`);
        lines.push(`      <path d="${d}" fill="white" />`);
      }
      if (mask.density !== undefined && mask.density < 1) {
        lines.push(
          `      <rect width="100%" height="100%" fill="white" opacity="${(1 - mask.density).toFixed(3)}" />`,
        );
      }
      lines.push(`    </mask>`);
    }
  } else if (hasSourceNode) {
    const sourceNode = doc.nodes[mask.sourceNodeId!]!;
    const sourceTransform = affineToSvg(nodeEffectiveTransform(sourceNode));
    if (mask.type === 'clip') {
      const fillRuleAttr = mask.fillRule === 'evenodd' ? ` clip-rule="evenodd"` : '';
      const unitsAttr = mask.linked === false ? ` clipPathUnits="userSpaceOnUse"` : '';
      lines.push(`    <clipPath id="${maskId}"${fillRuleAttr}${unitsAttr}>`);
      if (sourceNode.kind === 'shape') {
        const s = sourceNode.shape;
        lines.push(`      <g transform="${sourceTransform}">`);
        lines.push(`        <${svgElementForShape(s)} fill="black" />`);
        lines.push(`      </g>`);
      } else {
        lines.push(`      <use href="#${sourceNode.id}" />`);
      }
      lines.push(`    </clipPath>`);
    } else {
      const maskTypeAttr = mask.type === 'luminance' ? ` mask-type="luminance"` : '';
      const unitsAttr =
        mask.linked === false
          ? ` maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"`
          : '';
      let filterAttr = '';
      if (mask.feather && mask.feather > 0) {
        const filterId = `${maskId}-filter`;
        lines.push(`    <filter id="${filterId}">`);
        lines.push(`      <feGaussianBlur stdDeviation="${mask.feather}" />`);
        lines.push(`    </filter>`);
        filterAttr = ` filter="url(#${filterId})"`;
      }
      lines.push(`    <mask id="${maskId}"${maskTypeAttr}${filterAttr}${unitsAttr}>`);
      if (mask.inverted) {
        lines.push(`      <rect width="100%" height="100%" fill="white" />`);
        lines.push(`      <use href="#${sourceNode.id}" fill="black" />`);
      } else {
        lines.push(`      <rect width="100%" height="100%" fill="black" />`);
        lines.push(`      <use href="#${sourceNode.id}" fill="white" />`);
      }
      if (mask.density !== undefined && mask.density < 1) {
        lines.push(
          `      <rect width="100%" height="100%" fill="white" opacity="${(1 - mask.density).toFixed(3)}" />`,
        );
      }
      lines.push(`    </mask>`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/** Walk a subtree and collect doc-level mask defs. */
function docCollectMaskDefs(doc: Document, rootIds: string[]): string[] {
  const defs: string[] = [];
  const seen = new Set<string>();
  const walk = (node: SceneNode): void => {
    const mask = resolveMask(node);
    if (mask && !seen.has(node.id)) {
      seen.add(node.id);
      const def = docBuildMaskDef(doc, node.id, mask);
      if (def) defs.push(def);
    }
    if (node.kind === 'frame' || node.kind === 'group') {
      for (const cid of node.children ?? []) {
        const child = doc.nodes[cid];
        if (child) walk(child);
      }
    }
  };
  for (const id of rootIds) {
    const node = doc.nodes[id];
    if (node) walk(node);
  }
  return defs;
}

/** Return the SVG element name for a shape, given the engine Shape type. */
function svgElementForShape(s: import('@varve/engine').Shape): string {
  switch (s.kind) {
    case 'rect':
      return `rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"`;
    case 'ellipse':
      return `ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}"`;
    case 'circle':
      return `circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"`;
    case 'line':
    case 'arrow':
      return `line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}"`;
    case 'polygon':
    case 'star':
      return `polygon points="${shapeVerticesToPoints(s, 3)}"`;
    case 'table':
      return `rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"`;
    case 'path':
      return `path d="${shapePathToData(s, 3)}"`;
  }
}

function nodeToSvg(
  node: SceneNode,
  doc: Document,
  depth: number,
  options: SvgExportOptions,
): string {
  if (node.kind === 'group' && node.boolean) {
    const resolved = resolveLiveBooleanForExport(node, doc);
    if (resolved) return nodeToSvg(resolved, doc, depth, options);
  }
  if (!options.includeHidden && !node.visible) return '';
  const precision = options.precision ?? 3;
  const indent = options.minify ? '' : '  '.repeat(depth);
  const fill = rgba(node.fill);
  const transform = affineToSvg(nodeEffectiveTransform(node));
  const compositing = svgCompositing(node, node.kind === 'frame' || node.kind === 'group');
  const compositingAttrs = [
    ...compositing.attributes,
    ...(compositing.styles.length > 0 ? [`style="${compositing.styles.join(' ')}"`] : []),
  ];
  const compositingSuffix = compositingAttrs.length > 0 ? ` ${compositingAttrs.join(' ')}` : '';

  const mask = resolveMask(node);
  const maskAttr = mask ? (mask.type === 'clip' && !mask.inverted ? `clip-path` : `mask`) : null;
  const maskUri = maskAttr ? `url(#mask-${node.id})` : null;

  switch (node.kind) {
    case 'shape': {
      // Live warp modifiers bake to export-quality path geometry here, using
      // the same canonical evaluator as the per-node emitter in svg.ts so the
      // two export paths cannot resolve different geometry.
      const s = exportShapeOf(node, doc);
      // Image fill: render <image> element instead of geometry shape.
      if (isImageShape(node)) {
        const imgFill = node.fills?.find((f) => f.type === 'image' && f.image?.src);
        if (imgFill?.image) {
          const img = imgFill.image;
          const href = escapeXml(img.src);
          const placement = imagePlacementForShape(node, img);
          if (!placement) return '';
          const clipId = `clip-${node.id}`;
          const cropClipId = `crop-${node.id}`;
          const perspectiveImage = img.perspective
            ? buildPerspectiveImageSvg({
                href,
                w: placement.bounds.w,
                h: placement.bounds.h,
                quad: img.perspective.quad,
                nodeId: node.id,
                indent: `${indent}    `,
                minify: options.minify === true,
                placement,
                sourceWidth: placement.sourceWidth,
                sourceHeight: placement.sourceHeight,
              })
            : null;
          // The perspective emitter already folds crop/rotation/flip into
          // each triangle's source mapping. Applying the legacy content
          // transform or crop clip as well would transform the result twice.
          const contentTransform = perspectiveImage ? '' : imageContentTransform(placement);
          const contentTransformAttr = contentTransform ? ` transform="${contentTransform}"` : '';
          const cropDef =
            img.crop && !perspectiveImage
              ? `${indent}  <clipPath id="${cropClipId}" clipPathUnits="userSpaceOnUse"><rect ${svgRect(placement.sampleDrawRect)} /></clipPath>${options.minify ? '' : '\n'}`
              : '';
          const cropAttr = img.crop && !perspectiveImage ? ` clip-path="url(#${cropClipId})"` : '';
          // Perspective (four-corner) fill: SVG has no projective primitive,
          // so emit a triangle-subdivided approximation instead of the flat
          // <image>. Falls back to the flat emit when the quad is invalid.
          const imageTag =
            perspectiveImage ??
            `${indent}    <image href="${href}" ${svgRect(placement.drawRect)} preserveAspectRatio="none" />`;
          const outerMaskAttr = maskUri ? ` ${maskAttr}="${maskUri}"` : '';
          const nl = options.minify ? '' : '\n';
          return [
            `${indent}<g transform="${transform}"${outerMaskAttr}${compositingSuffix}>`,
            `${indent}  <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><${svgElementForShape(s)} /></clipPath>`,
            cropDef.trimEnd(),
            `${indent}  <g clip-path="url(#${clipId})">`,
            `${indent}    <g${contentTransformAttr}${cropAttr}>`,
            imageTag,
            `${indent}    </g>`,
            `${indent}  </g>`,
            `${indent}</g>`,
          ]
            .filter(Boolean)
            .join(nl);
        }
      }
      let tag: string;
      switch (s.kind) {
        case 'rect':
          tag = `${indent}<rect x="${fmtNum(s.x, precision)}" y="${fmtNum(s.y, precision)}" width="${fmtNum(s.w, precision)}" height="${fmtNum(s.h, precision)}" fill="${fill}" transform="${transform}"${compositingSuffix} />`;
          break;
        case 'ellipse':
          tag = `${indent}<ellipse cx="${fmtNum(s.cx, precision)}" cy="${fmtNum(s.cy, precision)}" rx="${fmtNum(s.rx, precision)}" ry="${fmtNum(s.ry, precision)}" fill="${fill}" transform="${transform}"${compositingSuffix} />`;
          break;
        case 'circle':
          tag = `${indent}<circle cx="${fmtNum(s.cx, precision)}" cy="${fmtNum(s.cy, precision)}" r="${fmtNum(s.r, precision)}" fill="${fill}" transform="${transform}"${compositingSuffix} />`;
          break;
        case 'line':
          tag = `${indent}<line x1="${fmtNum(s.from[0], precision)}" y1="${fmtNum(s.from[1], precision)}" x2="${fmtNum(s.to[0], precision)}" y2="${fmtNum(s.to[1], precision)}" stroke="${fill}" stroke-width="${fmtNum(s.tolerance * 2, precision)}" stroke-linecap="round" transform="${transform}"${compositingSuffix} />`;
          break;
        case 'polygon':
          tag = `${indent}<polygon points="${shapeVerticesToPoints(s, precision)}" fill="${fill}" transform="${transform}"${compositingSuffix} />`;
          break;
        case 'star':
          tag = `${indent}<polygon points="${shapeVerticesToPoints(s, precision)}" fill="${fill}" transform="${transform}"${compositingSuffix} />`;
          break;
        case 'path': {
          const fillRule = s.fillRule ?? (s.holes && s.holes.length > 0 ? 'evenodd' : undefined);
          const fillRuleAttr = fillRule ? ` fill-rule="${fillRule}"` : '';
          tag = `${indent}<path d="${shapePathToData(s, precision)}" fill="${fill}"${fillRuleAttr} transform="${transform}"${compositingSuffix} />`;
          break;
        }
        default:
          tag = `${indent}<!-- unsupported shape: ${s.kind} -->`;
      }
      if (maskUri) {
        return `${indent}<g ${maskAttr}="${maskUri}" transform="${transform}">\n${tag}\n${indent}</g>`;
      }
      return tag;
    }
    case 'text': {
      const pathDef = pathTextSvgDef(node, doc, indent);
      const pathContent =
        pathDef && node.pathTextSettings
          ? `<textPath href="#${pathTextSvgId(node.id, node.pathTextSettings.pathNodeId)}" startOffset="${Math.max(0, Math.min(1, node.pathTextSettings.startOffset ?? 0)) * 100}%">${pathTextSvgContent(node)}</textPath>`
          : escapeXml(node.text);
      const pathAttrs =
        pathDef && node.pathTextSettings
          ? ` data-varve-text-mode="path" data-varve-path-node="${escapeXml(node.pathTextSettings.pathNodeId)}" data-varve-path-side="${node.pathTextSettings.side ?? 'top'}"`
          : '';
      const missingComment =
        node.textMode === 'path' && node.pathTextSettings && !pathDef
          ? `<!-- varve: path text — referenced path ${node.pathTextSettings.pathNodeId} not found, exported as flat text -->\n${indent}`
          : '';
      const tag = `${indent}${missingComment}<text x="0" y="0" fill="${fill}" font-size="${node.fontSize}" font-family="${node.fontFamily ?? 'Inter'}" font-weight="${node.fontWeight ?? 400}" transform="${transform}"${pathAttrs}${compositingSuffix}>${pathContent}</text>`;
      if (maskUri) {
        return `${indent}<g ${maskAttr}="${maskUri}" transform="${transform}">\n${tag}\n${indent}</g>`;
      }
      return tag;
    }
    case 'frame':
    case 'group': {
      const filtered = (node.children ?? []).filter(
        (cid) => !(mask?.hideMaskSource && mask.sourceNodeId === cid),
      );
      const children = filtered
        .map((cid: NodeId) => {
          const child = doc.nodes[cid];
          return child ? nodeToSvg(child, doc, depth + 1, options) : '';
        })
        .filter(Boolean)
        .join(options.minify ? '' : '\n');
      const sep = options.minify ? '' : '\n';
      let attrs = ` transform="${transform}"`;
      attrs += compositingSuffix;
      if (mask) {
        const ref = `url(#mask-${node.id})`;
        if (mask.type === 'clip' && !mask.inverted) {
          attrs = ` clip-path="${ref}"${attrs}`;
        } else {
          attrs = ` mask="${ref}"${attrs}`;
        }
      }
      return `${indent}<g${attrs}>${sep}${children}${sep}${indent}</g>`;
    }
    case 'adjustment': {
      const asset = options.rasterAssets?.[node.id];
      if (asset) {
        const w = asset.cssWidth;
        const h = asset.cssHeight;
        const href = escapeXml(asset.dataUrl);
        return `${indent}<image href="${href}" x="0" y="0" width="${w}" height="${h}" transform="${transform}"${compositingSuffix} />`;
      }
      return '';
    }
    default:
      return '';
  }
}

/** Export a Document to a standalone SVG string. (legacy, backward-compatible) */
export function exportDocumentToSvg(doc: Document): string {
  const w = doc.canvasWidth ?? 1920;
  const h = doc.canvasHeight ?? 1080;
  return exportDocumentToSvgAdvanced(doc, {}, { x: 0, y: 0, w, h });
}

/** Export a Document to SVG with advanced options. */
export function exportDocumentToSvgAdvanced(
  doc: Document,
  options: SvgExportOptions,
  boundsOverride?: { x: number; y: number; w: number; h: number },
): string {
  const bounds = boundsOverride ?? computeDocumentBounds(doc);
  const nl = options.minify ? '' : '\n';
  const visibleRootIds = documentExportRootIds(doc);

  // Collect mask defs across all visible root subtrees
  const maskDefs = docCollectMaskDefs(doc, visibleRootIds);
  const pathTextDefs = visibleRootIds.flatMap((id) => {
    const node = doc.nodes[id];
    return node ? collectPathTextDefs(doc, node) : [];
  });
  const uniquePathTextDefs = pathTextDefs.filter((def, index, all) => {
    const id = def.match(/\bid="([^"]+)"/)?.[1];
    if (!id) return true;
    return all.findIndex((candidate) => candidate.match(/\bid="([^"]+)"/)?.[1] === id) === index;
  });
  const defsSection =
    maskDefs.length > 0 || uniquePathTextDefs.length > 0
      ? `  <defs>${nl}${[...maskDefs, ...uniquePathTextDefs].join(nl)}${nl}  </defs>${nl}`
      : '';

  const children = visibleRootIds
    .map((id: NodeId) => {
      const node = doc.nodes[id];
      return node ? nodeToSvg(node, doc, 2, options) : '';
    })
    .filter(Boolean)
    .join(nl);

  const parts: string[] = [];
  if (!options.minify) {
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  }
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}" width="${bounds.w}" height="${bounds.h}">`,
  );
  parts.push(
    `  <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="#ffffff" />`,
  );
  if (defsSection) parts.push(defsSection);
  parts.push(children);
  parts.push(`</svg>`);

  return parts.join(nl);
}

/** Export a Document to React/Tailwind JSX. (legacy, backward-compatible) */
export function exportDocumentToReact(doc: Document): string {
  const children = doc.rootChildren
    .map((id: NodeId) => {
      const node = doc.nodes[id];
      if (!node) return '';
      const fill = rgba(node.fill);
      switch (node.kind) {
        case 'shape': {
          const s = node.shape;
          const t = affineToSvg(nodeEffectiveTransform(node));
          switch (s.kind) {
            case 'rect':
              return `        <rect x={${s.x}} y={${s.y}} width={${s.w}} height={${s.h}} fill="${fill}" style={{ transform: "${t}" }} />`;
            case 'ellipse':
              return `        <ellipse cx={${s.cx}} cy={${s.cy}} rx={${s.rx}} ry={${s.ry}} fill="${fill}" style={{ transform: "${t}" }} />`;
            case 'circle':
              return `        <circle cx={${s.cx}} cy={${s.cy}} r={${s.r}} fill="${fill}" style={{ transform: "${t}" }} />`;
            case 'line':
              return `        <line x1={${s.from[0]}} y1={${s.from[1]}} x2={${s.to[0]}} y2={${s.to[1]}} stroke="${fill}" strokeWidth={${s.tolerance * 2}} strokeLinecap="round" style={{ transform: "${t}" }} />`;
            case 'polygon':
            case 'star':
              return `        <polygon points="${shapeVerticesToPoints(s, 3)}" fill="${fill}" style={{ transform: "${t}" }} />`;
          }
          break;
        }
        case 'text':
          return `        <text x={0} y={0} fill="${fill}" fontSize={${node.fontSize}} style={{ transform: "${affineToSvg(nodeEffectiveTransform(node))}" }}>${escapeXml(node.text)}</text>`;
        case 'frame':
          return `        <g style={{ transform: "${affineToSvg(nodeEffectiveTransform(node))}" }}>\n          {/* frame children */}\n        </g>`;
        default:
          return '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  return [
    `import type { FC } from 'react';`,
    '',
    `export const ExportedScene: FC = () => (`,
    `  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%">`,
    `    <rect width="100%" height="100%" fill="#ffffff" />`,
    children,
    `  </svg>`,
    `);`,
    '',
  ].join('\n');
}

/** Export one selected node and its real nested scene children to React TSX. */
export function exportNodeToReact(node: SceneNode, doc: Document): string {
  const indent = (depth: number) => '  '.repeat(depth);
  const renderNode = (current: SceneNode, depth: number): string => {
    const pad = indent(depth);
    const fill = rgba(current.fill);
    const opacity = current.opacity === 1 ? '' : ` opacity={${current.opacity}}`;
    const transform = ` style={{ transform: "${affineToSvg(nodeEffectiveTransform(current))}" }}`;
    const id = ` data-node-id="${escapeXml(current.id)}"`;

    if (current.kind === 'shape') {
      const shape = current.shape;
      switch (shape.kind) {
        case 'rect':
          return `${pad}<rect${id} x={${shape.x}} y={${shape.y}} width={${shape.w}} height={${shape.h}} fill="${fill}"${opacity}${transform} />`;
        case 'ellipse':
          return `${pad}<ellipse${id} cx={${shape.cx}} cy={${shape.cy}} rx={${shape.rx}} ry={${shape.ry}} fill="${fill}"${opacity}${transform} />`;
        case 'circle':
          return `${pad}<circle${id} cx={${shape.cx}} cy={${shape.cy}} r={${shape.r}} fill="${fill}"${opacity}${transform} />`;
        case 'line':
          return `${pad}<line${id} x1={${shape.from[0]}} y1={${shape.from[1]}} x2={${shape.to[0]}} y2={${shape.to[1]}} stroke="${fill}" strokeWidth={${shape.tolerance * 2}}${opacity}${transform} />`;
        case 'polygon':
        case 'star':
          return `${pad}<polygon${id} points="${shapeVerticesToPoints(shape, 3)}" fill="${fill}"${opacity}${transform} />`;
        default:
          return `${pad}<g${id}${opacity}${transform} />`;
      }
    }

    if (current.kind === 'text') {
      return `${pad}<text${id} x={0} y={0} fill="${fill}" fontSize={${current.fontSize}}${opacity}${transform}>${escapeXml(current.text)}</text>`;
    }

    if (current.kind === 'frame' || current.kind === 'group') {
      const children = current.children
        .map((childId) => doc.nodes[childId])
        .filter((child): child is SceneNode => Boolean(child))
        .map((child) => renderNode(child, depth + 1))
        .join('\n');
      return `${pad}<g${id}${opacity}${transform}>${children ? `\n${children}\n${pad}` : ''}</g>`;
    }

    return `${pad}<g${id}${opacity}${transform} />`;
  };

  return [
    `import type { FC } from 'react';`,
    '',
    `export const ExportedScene: FC = () => (`,
    `  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%">`,
    renderNode(node, 2),
    `  </svg>`,
    `);`,
    '',
  ].join('\n');
}

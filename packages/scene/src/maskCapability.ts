/**
 * Mask capability matrix and compatibility outcomes.
 *
 * Declares per-format capabilities for mask types and features, enabling
 * exporters and importers to make granular decisions: preserve structurally,
 * convert compatibly, rasterize locally, or block with an explanation.
 *
 * One canonical mask model (Mask union) is shared by editor, renderer,
 * persistence, importers, and exporters. This module is the single source
 * of truth for what each format can represent.
 *
 * ── Format capabilities ──────────────────────────────────────────────────────
 *
 * SVG 1.1:
 *   CAN: clip-path (vector), mask (alpha/luminance), inverted masks,
 *        feather via mask filter, nested masks, raster mask images.
 *   CANNOT: effects on masked content (must be rasterized), blend modes on
 *           mask groups.
 *   LOSSES: effects → rasterized subtree.
 *
 * PDF 2.0 (ISO 32000-2):
 *   CAN: clip (vector path), alpha/luminance (soft masks / SMask),
 *        inverted masks (via blend or explicit SMask invert), unlinked
 *        transforms, nested masks (up to 4 levels), raster mask images.
 *   CAN: feather for alpha/luminance (soft mask with function), density.
 *   CANNOT: feather for clip masks (no soft-edge clip in PDF).
 *   CANNOT: fillRule for alpha/luminance (soft masks ignore fill rule).
 *   CANNOT: effects with masks (must rasterize subtree).
 *   CANNOT: blend modes on transparency groups in all PDF consumers.
 *   LOSSES: clip feather → dropped; nested >4 levels → rasterized;
 *           effects → rasterized subtree; inverted clip → converted.
 *
 * PSD (Adobe Photoshop):
 *   CAN: layer masks (alpha), vector masks (clip/path), inverted masks,
 *        feather, density, unlinked transforms, hide mask source.
 *   CANNOT: fill rule with alpha/luminance (PSD masks are always additive).
 *   CANNOT: nested masks beyond 2 levels of container nesting.
 *   CANNOT: effects with masks (no cross-layer mask+effect compositing).
 *   LOSSES: nested >2 levels → flattened; effects → unsupported.
 *
 * PNG / raster:
 *   CAN: all mask types (flattened to pixel alpha), feather, density,
 *        inverted (pixel inversion), fill rule (pixel-level).
 *   CANNOT: preserve unlinked transforms (everything is baked to pixels).
 *   CANNOT: preserve hide-mask-source (baked to pixels, source invisible).
 *   LOSSES: unlinked transform lost, hide-mask-source lost — everything
 *           rasterizes to a single flat pixel grid.
 *
 * Research basis: PDF 2.0 (ISO 32000-2) soft masks / transparency groups,
 * SVG 1.1 clip-path / mask, PSD layer mask / vector mask specs.
 */
import type { Mask, MaskType, SceneNode } from './types';

// ── Scene capabilities ────────────────────────────────────────────────────

/**
 * True for a node whose own rendered output can receive a layer mask.
 *
 * This is intentionally about compositing, not source media. A shape, live
 * text, path, table, and raster layer all have different authoritative data,
 * but each produces visual coverage that can be masked without conversion.
 */
export function isVisualMaskTarget(node: SceneNode): boolean {
  return (
    node.kind === 'shape' ||
    node.kind === 'text' ||
    node.kind === 'path' ||
    node.kind === 'table' ||
    node.kind === 'rasterLayer'
  );
}

/** A node may receive a structural container mask or a mask on its own output. */
export function canReceiveLayerMask(node: SceneNode): boolean {
  return (
    isVisualMaskTarget(node) ||
    node.kind === 'frame' ||
    node.kind === 'group' ||
    node.kind === 'adjustment'
  );
}

/**
 * Pixel masks with `node-local-pixels` coordinates are valid on every visual
 * leaf. Frames retain their distinct `container-local-pixels` representation;
 * groups deliberately do not expose a painted mask until they have a bounded
 * local coordinate space.
 */
export function canReceiveRasterMask(node: SceneNode): boolean {
  return isVisualMaskTarget(node) || node.kind === 'frame';
}

/** A renderable node can supply alpha/luminance coverage for a live matte. */
export function canSupplyMaskCoverage(node: SceneNode): boolean {
  return isVisualMaskTarget(node) || node.kind === 'frame' || node.kind === 'group';
}

// ── Compatibility outcomes ────────────────────────────────────────────────

export type CompatibilityOutcome = 'preserved' | 'converted' | 'rasterized' | 'blocked';

export interface CompatibilityResult {
  outcome: CompatibilityOutcome;
  /** Human-readable explanation of what happened or why it was blocked. */
  detail: string;
  /** Whether the result is lossless (preserved) vs lossy. */
  lossless: boolean;
}

// ── Per-feature capability ─────────────────────────────────────────────────

export type FeatureCapability = 'native' | 'converted' | 'rasterized' | 'unsupported';

export interface MaskFeatureCapabilities {
  /** Mask type itself (clip / alpha / luminance). */
  type: FeatureCapability;
  /** Inverted mask. */
  inverted: FeatureCapability;
  /** Feather (soft edge). */
  feather: FeatureCapability;
  /** Density/strength. */
  density: FeatureCapability;
  /** Unlinked mask transform. */
  unlinkedTransform: FeatureCapability;
  /** Hide mask source. */
  hideMaskSource: FeatureCapability;
  /** Fill rule (nonzero / evenodd). */
  fillRule: FeatureCapability;
  /** Nested masks (mask on a masked container). */
  nested: FeatureCapability;
  /** Mask combined with effects on the masked container. */
  withEffects: FeatureCapability;
  /** Mask on a group (not just frame). */
  onGroup: FeatureCapability;
}

// ── Format capability declaration ──────────────────────────────────────────

export interface FormatCapabilityMatrix {
  format: string;
  label: string;
  /** Per mask-type feature capabilities. */
  clip: MaskFeatureCapabilities;
  alpha: MaskFeatureCapabilities;
  luminance: MaskFeatureCapabilities;
  /** Maximum nesting depth supported (Infinity for unlimited). */
  maxNestingDepth: number;
  /** Whether raster (PNG) masks can be embedded. */
  supportsRasterMask: boolean;
  /** Whether blend modes are supported (for masked groups). */
  supportsBlendModes: boolean;
  /** Whether opacity groups are supported. */
  supportsOpacityGroups: boolean;
}

// ── Capability matrices ────────────────────────────────────────────────────

/**
 * Raster (PNG/JPEG/WebP): masks are baked into the pixel alpha channel.
 *
 * Every mask feature is 'native' at the pixel level — feather, density,
 * fillRule all resolve visually. However, unlinked transforms and
 * hide-mask-source CANNOT be preserved structurally because everything
 * is flattened to a single pixel grid. Marking them 'native' here means
 * the visual result is correct, but the form above indicates these
 * structural features are lost in the rasterized output.
 */
const RASTER_MASK: MaskFeatureCapabilities = {
  type: 'native',
  inverted: 'native',
  feather: 'native',
  density: 'native',
  unlinkedTransform: 'native',
  hideMaskSource: 'native',
  fillRule: 'native',
  nested: 'native',
  withEffects: 'native',
  onGroup: 'native',
};

const SVG_MASK: MaskFeatureCapabilities = {
  type: 'native',
  inverted: 'native',
  feather: 'native',
  density: 'native',
  unlinkedTransform: 'native',
  hideMaskSource: 'native',
  fillRule: 'native',
  nested: 'native',
  withEffects: 'converted',
  onGroup: 'native',
};

const PDF_CLIP: MaskFeatureCapabilities = {
  type: 'native',
  inverted: 'converted',
  feather: 'unsupported',
  density: 'unsupported',
  unlinkedTransform: 'native',
  hideMaskSource: 'native',
  fillRule: 'native',
  nested: 'converted',
  withEffects: 'rasterized',
  onGroup: 'native',
};

const PDF_ALPHA: MaskFeatureCapabilities = {
  type: 'native',
  inverted: 'native',
  feather: 'native',
  density: 'native',
  unlinkedTransform: 'native',
  hideMaskSource: 'native',
  fillRule: 'unsupported',
  nested: 'converted',
  withEffects: 'rasterized',
  onGroup: 'native',
};

const PDF_LUMINANCE: MaskFeatureCapabilities = {
  type: 'native',
  inverted: 'native',
  feather: 'native',
  density: 'native',
  unlinkedTransform: 'native',
  hideMaskSource: 'native',
  fillRule: 'unsupported',
  nested: 'converted',
  withEffects: 'rasterized',
  onGroup: 'native',
};

const PSD_MASK: MaskFeatureCapabilities = {
  type: 'native',
  inverted: 'native',
  feather: 'native',
  density: 'native',
  unlinkedTransform: 'native',
  hideMaskSource: 'native',
  fillRule: 'unsupported',
  nested: 'converted',
  withEffects: 'unsupported',
  onGroup: 'native',
};

/**
 * SVG 1.1 — native mask support via <clipPath> and <mask> elements.
 *
 * - clip masks: <clipPath> with vector shapes
 * - alpha/luminance masks: <mask> with mask-type attribute
 * - Inversion via CSS or mask-type: luminance
 * - Feather via mask filter (Gaussian blur) on mask content
 * - Nested masking via nested <g> elements
 * - Raster mask images embedded as <image> in <mask>
 * - Effects on masked content: requires rasterization (no SVG effect compositing
 *   across mask boundaries that all renderers support consistently)
 *
 * Max nesting: unlimited (DOM tree depth).
 */
export const FORMAT_CAPABILITIES: Record<string, FormatCapabilityMatrix> = {
  svg: {
    format: 'svg',
    label: 'SVG',
    clip: { ...SVG_MASK },
    alpha: { ...SVG_MASK },
    luminance: { ...SVG_MASK },
    maxNestingDepth: Infinity,
    supportsRasterMask: true,
    supportsBlendModes: true,
    supportsOpacityGroups: true,
  },
  pdf: {
    format: 'pdf',
    label: 'PDF',
    clip: { ...PDF_CLIP },
    alpha: { ...PDF_ALPHA },
    luminance: { ...PDF_LUMINANCE },
    maxNestingDepth: 4,
    supportsRasterMask: true,
    supportsBlendModes: false,
    supportsOpacityGroups: true,
  },
  psd: {
    format: 'psd',
    label: 'PSD',
    clip: { ...PSD_MASK },
    alpha: { ...PSD_MASK },
    luminance: { ...PSD_MASK },
    maxNestingDepth: 2,
    supportsRasterMask: true,
    supportsBlendModes: true,
    supportsOpacityGroups: true,
  },
  png: {
    format: 'png',
    label: 'PNG (raster — masks flattened to alpha)',
    clip: { ...RASTER_MASK },
    alpha: { ...RASTER_MASK },
    luminance: { ...RASTER_MASK },
    maxNestingDepth: Infinity,
    supportsRasterMask: true,
    supportsBlendModes: true,
    supportsOpacityGroups: true,
  },
};

// ── Compatibility assessment ───────────────────────────────────────────────

export function getMaskFeatureCapability(
  format: string,
  maskType: MaskType,
  feature: keyof MaskFeatureCapabilities,
): FeatureCapability {
  const matrix = FORMAT_CAPABILITIES[format];
  if (!matrix) return 'unsupported';
  return matrix[maskType][feature];
}

export function assessMaskCompatibility(
  format: string,
  mask: Mask,
  opts: { nestedDepth?: number; hasEffects?: boolean; isRasterMask?: boolean } = {},
): CompatibilityResult {
  const matrix = FORMAT_CAPABILITIES[format];
  if (!matrix) {
    return {
      outcome: 'blocked',
      detail: `Unknown export format: ${format}`,
      lossless: false,
    };
  }

  const caps = matrix[mask.type];
  const depth = opts.nestedDepth ?? 0;

  // Raster (PNG/JPEG) masks are baked into pixels — all mask features resolve
  // visually but structural metadata is lost. The matrix marks them 'native'
  // because the pixel result is correct; the calling code should still inform
  // the user about structural loss.
  if (format === 'png' || format === 'jpg' || format === 'webp' || format === 'avif') {
    if (mask.linked === false) {
      return {
        outcome: 'converted',
        detail: `Raster export (${format.toUpperCase()}): unlinked mask transform lost (flattened to pixels). Mask visual effect is preserved.`,
        lossless: false,
      };
    }
    if (mask.hideMaskSource) {
      return {
        outcome: 'converted',
        detail: `Raster export (${format.toUpperCase()}): hide-mask-source lost (mask source baked into pixel layer). Mask visual effect is preserved.`,
        lossless: false,
      };
    }
  }

  // Check nesting depth
  if (depth > matrix.maxNestingDepth) {
    return {
      outcome: 'rasterized',
      detail: `Mask nesting depth ${depth} exceeds ${format} maximum ${matrix.maxNestingDepth}. Subtree will be rasterized.`,
      lossless: false,
    };
  }

  // Check effects compatibility
  if (opts.hasEffects) {
    if (caps.withEffects === 'rasterized') {
      return {
        outcome: 'rasterized',
        detail: `${format} cannot preserve masks combined with effects — subtree will be rasterized`,
        lossless: false,
      };
    }
    if (caps.withEffects === 'unsupported') {
      return {
        outcome: 'blocked',
        detail: `${format} does not support masks combined with effects. Remove the mask or effects before exporting.`,
        lossless: false,
      };
    }
  }

  // Check that the mask type itself is supported for the format
  if (caps.type === 'unsupported') {
    return {
      outcome: 'blocked',
      detail: `${format} does not support ${mask.type} masks`,
      lossless: false,
    };
  }

  // Check individual features
  const losses: string[] = [];
  if (mask.inverted && caps.inverted === 'converted') {
    losses.push('inverted mask converted to equivalent visual result');
  }
  if (mask.feather && mask.feather > 0 && caps.feather === 'unsupported') {
    losses.push('feather lost');
  }
  if (mask.density !== undefined && mask.density < 1 && caps.density === 'unsupported') {
    losses.push('density lost');
  }
  if (mask.linked === false && caps.unlinkedTransform === 'unsupported') {
    losses.push('unlinked transform lost');
  }
  if (mask.hideMaskSource && caps.hideMaskSource === 'unsupported') {
    losses.push('hide-mask-source lost');
  }
  if (
    mask.fillRule !== undefined &&
    mask.fillRule !== 'nonzero' &&
    caps.fillRule === 'unsupported'
  ) {
    losses.push('fill rule lost');
  }
  if (caps.nested === 'converted' && depth > 0) {
    losses.push('nested mask flattened');
  }

  if (losses.length > 0) {
    return {
      outcome: 'converted',
      detail: `${format} conversion: ${losses.join(', ')}`,
      lossless: false,
    };
  }

  return {
    outcome: 'preserved',
    detail: `Mask preserved natively in ${format}`,
    lossless: true,
  };
}

export function isFormatSupported(format: string): boolean {
  return format in FORMAT_CAPABILITIES;
}

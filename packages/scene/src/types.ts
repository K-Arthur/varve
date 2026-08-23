/**
 * Scene document types (Strata plan §3.1, §9 — slots-ready model).
 *
 * Node types: ShapeNode (rect/ellipse/circle/line/polygon/star), TextNode,
 * GroupNode (container), FrameNode (layout-capable container, doubles as
 * component instance via componentId).
 *
 * Layering note: the primitive geometry types (Affine, Color, Point, Shape) are
 * imported from @varve/engine for now. A later refactor moves them to
 * @varve/shared so scene does not depend on the renderer package.
 *
 * F6 (Inspector): extended with Stroke, Effect, BlendMode, opacity, rotation,
 * per-corner radius, and stacked-fill type enums. All new fields have safe
 * defaults so existing documents deserialize correctly.
 */
import type {
  Adjustment,
  Affine,
  DepthMapResource,
  PathPoint,
  Shape,
  WarpModifier,
  WarpSettings,
} from '@varve/engine';
import type { AnimatedAssetMetadata, MediaFillSettings, RasterColorEncoding } from '@varve/shared';

export type { AnimatedAssetMetadata, MediaFillSettings } from '@varve/shared';

import type {
  BleedConfig,
  GradientInterpolationSpace,
  ManagedColor,
  SafeAreaConfig,
  SlugConfig,
} from './colorManagement';
import type { ExportPreset } from './export-types';
import { normalizeImagePerspective } from './imagePerspective';
import type { VariableModifier } from './modifiers';
import type { TableModel } from './table';

export type {
  BaselineGrid,
  DocumentGrid,
  DocumentGridSettings,
  GridDefinition,
  GridScope,
  IsometricAxis,
  IsometricGrid,
  IsometricPreset,
  IsometricPresetDef,
  LayoutGrid,
  PixelGrid,
} from './gridTypes';

export {
  createDefaultIsometricGrid,
  createStandardIsometricAxes,
  normaliseAngle,
  validateIsometricAxes,
  validateIsometricGrid,
} from './gridTypes';

export type { GradientInterpolationSpace, ManagedColor };

export type NodeId = string;

export type LayerColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | null;

// ── Constraints types (Figma-style responsive positioning) ─────────────────

export type ConstraintAxis = 'min' | 'max' | 'center' | 'stretch' | 'scale';

export interface Constraints {
  horizontal: ConstraintAxis;
  vertical: ConstraintAxis;
}

// ── Mask types ──────────────────────────────────────────────────────────────

/**
 * Mask type determines how the mask source node controls visibility:
 * - 'clip': the source node's vector outline clips content (boolean, hard edge)
 * - 'alpha': the source node's alpha channel controls content opacity
 * - 'luminance': the source node's luminance (perceived brightness) controls
 *   content opacity. Black = transparent, white = opaque, following the SVG
 *   mask luminance formula: L = 0.2126*R + 0.7152*G + 0.0722*B (in linear RGB),
 *   multiplied by the source alpha.
 */
export type MaskType = 'clip' | 'alpha' | 'luminance';

/** Fill rule for clip masks and vector masks. */
export type MaskFillRule = 'nonzero' | 'evenodd';

/**
 * Independent vector mask data.
 * When set on a Mask, the mask geometry comes from this path data
 * rather than from a child node. The mask is resolution-independent
 * and remains editable via the Pen/Pencil tools or NodeEditTool.
 *
 * A vector mask can co-exist with a sourceNodeId reference; when both
 * are present, the vector mask defines the clipping geometry and the
 * sourceNodeId provides visual content (if hideMaskSource is false).
 */
export interface VectorMaskData {
  /** Control points in mask-local coordinates. */
  points: PathPoint[];
  /** Whether the last point connects back to the first. */
  closed: boolean;
  /** Fill rule for determining interior vs exterior. */
  fillRule: MaskFillRule;
}

/** Reproducibility metadata for an automatically generated subject mask. */
export interface BackgroundRemovalProvenance {
  method: 'quick' | 'ai-balanced' | 'ai-quality';
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  runtime: 'typescript' | 'wasm' | 'webgl' | 'webgpu' | 'native-cpu' | 'native-accelerated';
  generatedAt: number;
  confidence?: number;
  /** Legacy edge-colour cleanup setting retained during v2.0 migration. */
  decontaminate?: boolean;
  /** How this raster mask entered the native asset table. */
  origin?: 'native' | 'legacy-background-removal-preview';
}

/** Immutable PNG payload stored once at the document level. */
export interface RasterMaskAsset {
  id: string;
  mimeType: 'image/png';
  dataUrl: string;
  width: number;
  height: number;
  byteLength: number;
  checksum?: string;
}

/**
 * Identity of the source pixels used to generate a raster mask.
 * `source-metadata` is deterministic but deliberately does not claim to be a
 * content digest. Callers with a verified digest should use `content-sha256`.
 */
export type RasterMaskSourceIdentity =
  | {
      kind: 'source-metadata';
      locator: string;
      pixelWidth?: number;
      pixelHeight?: number;
      revision: number;
    }
  | {
      kind: 'content-sha256';
      sha256: string;
      pixelWidth?: number;
      pixelHeight?: number;
      revision: number;
    };

/** Placement and source-revision metadata for a raster alpha mask. */
export interface RasterMaskData {
  assetId: string;
  /**
   * Pixel coordinate space of the mask payload:
   * - `source-image-pixels`: 1:1 with the masked image's source pixels
   *   (image-filled shape nodes).
   * - `legacy-preview-pixels`: v2.1 legacy background-removal previews.
   * - `container-local-pixels`: mask pixels map 1:1 to the frame's local
   *   units (0..w, 0..h), stretched with the container transform — the
   *   brush-painted layer-mask form for FrameNodes.
   */
  coordinateSpace: 'source-image-pixels' | 'legacy-preview-pixels' | 'container-local-pixels';
  sourceIdentity: RasterMaskSourceIdentity;
  editRevision?: number;
  staleReason?: 'source-replaced' | 'source-changed' | 'legacy-preview-resolution';
  provenance?: BackgroundRemovalProvenance;
}

/** A live source reference for rendered alpha/luminance coverage. */
export type LiveMatteSource =
  | { kind: 'scene-node'; nodeId: NodeId }
  | { kind: 'vector'; vectorMask: VectorMaskData }
  | { kind: 'raster-asset'; assetId: string };

/**
 * A mask on a container node (FrameNode, GroupNode, or AdjustmentNode).
 *
 * The mask designates one of the container's children as the mask source.
 * A mask source acts as a child (renders in the container) BUT the container
 * may choose to hide the mask source's direct rendering and instead use its
 * outline/alpha/luminance to clip or modulate the other children.
 *
 * A mask may also carry self-contained vector path data (`vectorMask`) for
 * resolution-independent vector masks that don't depend on a child node.
 *
 * Architecture notes:
 * - Masks are non-destructive and re-editable.
 * - A mask source must be a direct child of the container (when sourceNodeId
 *   is set). Vector masks (via `vectorMask`) have no such constraint.
 * - A container may have at most one mask.
 * - Nested masks are supported via nested containers.
 * - The mask source can have effects, fills, strokes, and transforms;
 *   these all contribute to the mask's effective shape/alpha/luminance.
 * - When both `sourceNodeId` and `vectorMask` are set, `vectorMask` defines
 *   the clipping geometry and `sourceNodeId` provides optional visual content.
 *
 * Research basis: Figma mask model, Adobe Photoshop layer masks,
 * Affinity Designer pixel/vector masks, SVG <clipPath>/<mask> specs.
 */
interface MaskPresentation {
  /** How the mask source controls visibility of masked content. */
  type: MaskType;
  /** Id of the child node used as the mask source. Must be a child of the container. */
  /** Whether the mask is active. When false, the mask is ignored during rendering. */
  visible: boolean;
  /**
   * Fill rule for clip/vector masks. Nonzero by default (SVG default).
   * Used only when type === 'clip' or when vectorMask is set.
   */
  fillRule?: MaskFillRule;
  /**
   * When true, the mask effect is inverted:
   * - clip: content inside the clip region is hidden, outside is visible
   * - alpha/luminance: transparent regions become opaque and vice versa
   * (default: false)
   */
  inverted?: boolean;
  /**
   * Feather radius in world-space pixels. Softens the mask edge by
   * applying a Gaussian blur to the mask's alpha/luminance values
   * before compositing. (default: 0, no feather)
   */
  feather?: number;
  /**
   * Overall mask density/strength as a value between 0 and 1.
   * 0 = mask has no effect (full visibility), 1 = full mask effect.
   * Applied after inversion and feather. (default: 1)
   */
  density?: number;
  /**
   * When true (default), the mask transforms with the masked content.
   * When false, the mask has its own independent transform.
   * (default: true)
   */
  linked?: boolean;
  /**
   * Independent mask transform used when linked === false.
   * If linked or transform is undefined, the mask source's own transform
   * is used (which itself is relative to the container).
   */
  transform?: Affine;
  /**
   * When true, the mask source node is hidden from direct rendering
   * but still contributes to the mask effect.
   * Like Figma's "hide mask source" or Photoshop's mask thumbnail.
   * (default: false — mask source is rendered normally)
   */
  hideMaskSource?: boolean;
  /** External/live source for alpha or luminance mattes. */
  matteSource?: LiveMatteSource;
}

/**
 * Exactly one effective mask source is present. A vector mask may additionally
 * reference a child node as optional visual content; vectorMask remains the
 * sole geometry source in that form.
 */
export type Mask = MaskPresentation &
  (
    | { sourceNodeId: NodeId; vectorMask?: never; rasterMask?: never }
    | { vectorMask: VectorMaskData; sourceNodeId?: NodeId; rasterMask?: never }
    | { rasterMask: RasterMaskData; sourceNodeId?: never; vectorMask?: never }
    | { matteSource: LiveMatteSource; sourceNodeId?: never; vectorMask?: never; rasterMask?: never }
  );

/** Ownership-neutral parameters for a rendered coverage binding. */
export interface EffectMaskBinding {
  source: LiveMatteSource;
  type: 'alpha' | 'luminance' | 'clip';
  visible?: boolean;
  inverted?: boolean;
  density?: number;
  feather?: number;
  linked?: boolean;
  transform?: Affine;
  coordinateSpace: 'target-local' | 'world';
}

// ── Guide interface ──────────────────────────────────────────────────────────

export interface Guide {
  id: string;
  axis: 'horizontal' | 'vertical';
  position: number;
  /** Page this guide belongs to (multi-page documents). Omitted on legacy flat docs. */
  pageId?: NodeId;
  locked?: boolean;
  color?: string;
}

// ── Appearance types (Inspector F6) ─────────────────────────────────────────

export type BlendMode =
  | 'passThrough'
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'plusDarker'
  | 'plusLighter';

export type StrokeAlign = 'inside' | 'center' | 'outside';
export type StrokeCap = 'butt' | 'round' | 'square';
export type StrokeJoin = 'miter' | 'round' | 'bevel';
export type ArrowheadStyle = 'none' | 'arrow' | 'circle' | 'square' | 'diamond';

export interface Stroke {
  color: ManagedColor;
  weight: number;
  align: StrokeAlign;
  dashPattern: number[];
  dashOffset: number;
  cap: StrokeCap;
  join: StrokeJoin;
  miterLimit: number;
  visible: boolean;
  /** Optional gradient for the stroke (takes precedence over `color` when set). */
  gradient?: GradientFill;
  /** Per-side weights for rects/frames: [top, right, bottom, left]. When set, overrides `weight`. */
  perSideWeights?: [number, number, number, number];
  /** Arrowhead at the start of a line/path. */
  arrowStart?: ArrowheadStyle;
  /** Arrowhead at the end of a line/path. */
  arrowEnd?: ArrowheadStyle;
}

export function defaultStroke(): Stroke {
  return {
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as ManagedColor,
    weight: 1,
    align: 'center',
    dashPattern: [],
    dashOffset: 0,
    cap: 'round',
    join: 'miter',
    miterLimit: 4,
    visible: true,
  };
}

export interface ChannelOffset {
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
}

type EffectVariant =
  | {
      type: 'dropShadow';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      x: number;
      y: number;
      blur: number;
      spread: number;
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'innerShadow';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      x: number;
      y: number;
      blur: number;
      spread: number;
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'layerBlur';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      radius: number;
      visible: boolean;
    }
  | {
      type: 'backgroundBlur';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      radius: number;
      visible: boolean;
    }
  | {
      type: 'depthBlur';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      /** Reference to Document.depthMaps. */
      depthMapId: string;
      /** Canonical depth: 0 = near, 1 = far. */
      focusDepth: number;
      /** In-focus interval around focusDepth, normalized 0..1. */
      focusRange: number;
      /** Maximum gather radius in source pixels. */
      blurStrength: number;
      /** 0 = hard transition, 1 = soft transition. */
      falloff: number;
      invert: boolean;
      edgeProtection: number;
      visible: boolean;
    }
  | {
      type: 'outerGlow';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      blur: number;
      spread: number;
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'innerGlow';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      blur: number;
      spread: number;
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'glassMaterial';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      blur: number;
      tint: ManagedColor;
      tintOpacity: number;
      saturation: number;
      brightness: number;
      noise: number;
      edgeHighlight: boolean;
      edgeHighlightWidth: number;
      edgeHighlightColor: ManagedColor;
      edgeHighlightOpacity: number;
      visible: boolean;
    }
  | {
      type: 'chromaticAberration';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      offsets: ChannelOffset;
      intensity: number;
      blendMode: BlendMode;
      opacity: number;
      visible: boolean;
    }
  | {
      type: 'glitch';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      seed: number;
      strength: number;
      density: number;
      sliceHeight: number;
      blockCount: number;
      blockSize: number;
      blockStrength: number;
      noiseIntensity: number;
      scanlineIntensity: number;
      scanlineSpacing: number;
      direction: 'horizontal' | 'vertical' | 'both';
      channelShift: ChannelOffset;
      channelShiftMode: 'static' | 'seeded';
      blendMode: BlendMode;
      opacity: number;
      visible: boolean;
    };

/** Stable, reorder-safe effect identity plus an optional stage-local mask. */
export type Effect = EffectVariant & {
  id?: string;
  mask?: EffectMaskBinding;
};

export type GradientType = 'linear' | 'radial' | 'angular' | 'diamond';

/**
 * A gradient may either pin its interpolation space or inherit the document
 * default. `undefined` is intentionally different: it is the legacy value
 * used by documents written before interpolation metadata existed and must
 * continue to render as Canvas2D's historical encoded-sRGB gradient.
 */

/**
 * Hue interpolation direction for cylindrical spaces (OKLCH, HSL).
 * Only meaningful when GradientInterpolationSpace is cylindrical.
 * - shorter: take the shorter arc around the hue circle (default)
 * - longer: take the longer arc
 * - increasing: always interpolate in the positive (CW) direction
 * - decreasing: always interpolate in the negative (CCW) direction
 */
export type HueInterpolation = 'shorter' | 'longer' | 'increasing' | 'decreasing';

/** How a gradient extends beyond its defined stop range. */
export type GradientTilingMode = 'none' | 'repeat' | 'reflect';

export interface GradientStop {
  position: number;
  color: ManagedColor;
  /** Bias for 50% blend point toward the next stop (0-1, default 0.5). */
  midpoint?: number;
}

export interface GradientFill {
  type: GradientType;
  stops: GradientStop[];
  rotation?: number;
  /** Pinned interpolation space; omitted legacy gradients render as encoded sRGB. */
  interpolationSpace?: GradientInterpolationSpace;
  /** Explicit inheritance marker for new gradients; absent means legacy sRGB. */
  interpolationSource?: 'document';
  /**
   * Hue interpolation direction for cylindrical spaces (OKLCH, HSL).
   * Ignored for non-cylindrical spaces (sRGB, linear-srgb, OKLab).
   * Default: 'shorter'.
   */
  hueInterpolation?: HueInterpolation;
  /** Full 2x3 fill transform matrix. When set, overrides rotation.
   *  Maps fill-internal [0,0]×[1,1] space to the node's local space.
   *  Backward-compat: rotation field auto-applies as rotate transform. */
  transform?: import('@varve/engine').Affine;
  /** How the gradient tiles beyond its [0,1] stop range (default: none). */
  tilingMode?: GradientTilingMode;
}

/** How an image fill is sized relative to the node bounds. */
export type ImageFit = 'fill' | 'fit' | 'stretch' | 'tile' | 'crop';

/**
 * Non-destructive crop window in source-pixel coordinates.
 *
 * Defines the visible region of the source image. Pixels outside this
 * rectangle are hidden but preserved — the crop can be re-edited, reset,
 * or removed without losing source data. When undefined, the entire source
 * image is visible.
 *
 * Coordinates are in the source image's natural pixel space (0,0 = top-left
 * of the full decoded image, before any EXIF rotation is applied by the
 * renderer).
 */
export interface ImageCropRect {
  /** X offset from source image left edge, in source pixels. */
  x: number;
  /** Y offset from source image top edge, in source pixels. */
  y: number;
  /** Width of the crop window in source pixels. */
  w: number;
  /** Height of the crop window in source pixels. */
  h: number;
}

/**
 * Where an asset's bytes live. Only 'embedded' ships today; 'linked' (an
 * external file resolved by path + fingerprint) is a deliberate future
 * addition — see docs/audits/smart-object-feasibility-audit.md. The record
 * shape below is designed so adding it later is a new `storage` value, not a
 * schema redesign.
 */
export type AssetStorageKind = 'embedded';

/**
 * EXIF orientation tag value (1-8) of a raster source. Kept as a local
 * literal union so the scene model does not depend on the engine's
 * metadata module; values are structurally identical.
 */
export type SourceExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * A colour profile stored once in `Document.iccProfiles` and referenced by
 * id from any number of `DocumentAsset.metadata.iccProfileId` entries, so
 * identical profiles are never duplicated per asset or per placement.
 */
export interface IccProfileEntry {
  /** Content-addressed id (`icc-<hash>`), stable for identical bytes. */
  id: string;
  /** Base64-encoded profile bytes (the canonical payload). */
  profileBase64: string;
  byteLength: number;
  /** Content hash of `profileBase64` (sync, non-cryptographic). */
  hash: string;
  /** ASCII `desc` tag, when present and printable. */
  description?: string;
  /** ICC profile class signature (e.g. 'mntr' display class). */
  profileClass?: string;
  /** ICC colour space signature (e.g. 'RGB ', 'CMYK', 'GRAY', 'Lab '). */
  colorSpace?: string;
  /** ICC version, e.g. '4.3.0'. */
  version?: string;
  /** ICC header rendering intent field (0-3: perceptual/relative/saturation/absolute). */
  renderingIntent?: number;
}

/**
 * Normalized ingestion metadata attached to a `DocumentAsset`. Rendering
 * metadata (orientation, ICC status) is understood once here, not per fill.
 *
 * Decode invariant: browser decoders apply EXIF orientation, so the decoded
 * representation is orientation-normalized. `orientation` records the
 * stored tag so callers can compute displayed dimensions; it is never
 * re-applied to decoded pixels.
 */
export interface ImageSourceMetadata {
  /** Stored EXIF orientation tag; absent means no rotation (tag 1). */
  orientation?: SourceExifOrientation;
  /** Stored (pre-orientation) pixel dimensions of the source. */
  pixelWidth?: number;
  pixelHeight?: number;
  /** Reference into `Document.iccProfiles`. */
  iccProfileId?: string;
  /** Outcome of ICC extraction: valid, explicitly invalid, or absent. */
  iccStatus?: 'valid' | 'invalid' | 'none';
  /** ICC `desc` tag label (display only, never authoritative). */
  iccDescription?: string;
  /**
   * Canonical colour interpretation of the source pixels (v2.19+). Carries
   * primaries, transfer, precision, provenance and diagnostics. Older
   * documents (and profiles that predate metadata extraction) omit it; the
   * read-time fallback is `legacy-assumed-srgb`, never silently claimed as
   * embedded metadata.
   */
  colorEncoding?: RasterColorEncoding;
}

/**
 * A document-level, content-addressed asset (v2.6+).
 *
 * Generalizes the `RasterMaskAsset` pattern (immutable payload stored once,
 * referenced by id) from raster masks to image fills. Multiple `ImageFillData`
 * values across any number of nodes/paints can share one `DocumentAsset` via
 * `assetId`, so placing the same image on many layers stores the bytes once.
 *
 * `dataUrl` is the canonical payload for 'embedded' storage. Per-usage
 * placement (fit/x/y/scale/crop) is NOT stored here — it stays on
 * `ImageFillData`, so each usage can be cropped/positioned independently
 * while sharing the same source bytes.
 */
export interface DocumentAsset {
  id: string;
  storage: AssetStorageKind;
  mimeType: string;
  /** Present when storage === 'embedded'. */
  dataUrl: string;
  /** Displayed (orientation-normalized) pixel dimensions of the source. */
  naturalWidth: number;
  naturalHeight: number;
  byteLength: number;
  /** Content hash of `dataUrl`, used for create-time dedup. */
  hash: string;
  /**
   * Normalized ingestion metadata (EXIF orientation, ICC status, stored
   * pixel dimensions). Optional so documents saved before metadata
   * extraction existed round-trip unchanged.
   */
  metadata?: ImageSourceMetadata;
  /**
   * Animated-media facts (v2.20+), probed from the container bytes for
   * animated GIF/APNG/WebP imports. The original encoded bytes stay
   * authoritative; decoded/composited frames are never serialized. Absent
   * for static images.
   */
  animated?: AnimatedAssetMetadata;
}

/**
 * Persisted continuous depth field. Kept separate from RasterMaskAsset:
 * masks express semantic coverage, while a depth map preserves scalar values
 * for effects and future range-based consumers.
 */
export type DepthMapAsset = DepthMapResource;

/**
 * Non-destructive upscale metadata stored on an image fill.
 *
 * When present, the fill's `assetId` references an upscaled asset while
 * `upscale.sourceAssetId` retains the original source for re-upscale or reset.
 */
export interface ImageFillUpscale {
  /** Source asset id before upscaling. */
  sourceAssetId: string;
  /** Upscaled output asset id currently displayed. */
  upscaleAssetId: string;
  /** User-facing mode and numeric scale. */
  mode: string;
  scale: number;
  /** AI model id when mode === 'ai-enhance'. */
  modelId?: string;
}

export interface ImageFillData {
  /**
   * Image source as a data URL.
   *
   * When `assetId` is set, this field is a materialized cache of
   * `Document.assets[assetId].dataUrl` — always kept in sync in-memory so
   * every existing reader keeps working unchanged, but treated as derived,
   * not authoritative: the canonical bytes live once in `Document.assets`,
   * and `src` is stripped from serialized output to avoid duplicating them
   * per-usage on disk (see `stripEmbeddedAssetPayloads` in version.ts).
   *
   * When `assetId` is unset, `src` is authoritative on its own (legacy
   * fills predating the asset system, or a plain file path).
   */
  src: string;
  /** Reference into `Document.assets`. See doc comment on `src` above. */
  assetId?: string;
  fit: ImageFit;
  /** Position offset in px (relative to node top-left) when fit !== 'fill'/'stretch'. */
  x: number;
  y: number;
  /** Scale multiplier (1 = natural). Used for 'tile' and 'fit'. */
  scale: number;
  /** Natural image width in pixels. When omitted, the node bounds width is used. */
  imageWidth?: number;
  /** Natural image height in pixels. When omitted, the node bounds height is used. */
  imageHeight?: number;
  /**
   * Non-destructive crop window in source-pixel coordinates.
   *
   * Defines which rectangular region of the source image is visible. When
   * undefined, the entire source image is shown. The crop is stored on the
   * fill (not baked into node geometry) so it can be re-edited, reset, or
   * removed after save/reopen without losing source pixels.
   *
   * Coordinate space: (0,0) = top-left of the full decoded source image.
   * The crop rect must satisfy 0 ≤ x, 0 ≤ y, x + w ≤ imageWidth,
   * y + h ≤ imageHeight (enforced by validateImageCropRect).
   */
  crop?: ImageCropRect;
  /**
   * Rotation of the image content within the node, in degrees clockwise.
   * Applied to the source pixels before fit/placement math. Stored on the
   * fill so it is independent of the node's object-space transform.
   */
  rotation?: number;
  /** Horizontal flip of the image content. Applied before fit/placement. */
  flipH?: boolean;
  /** Vertical flip of the image content. Applied before fit/placement. */
  flipV?: boolean;
  /** Non-destructive upscale metadata. */
  upscale?: ImageFillUpscale;
  /**
   * Non-destructive four-corner (perspective) transform. When present, the
   * image fill is rendered through the engine's projective `warpedImage`
   * primitive; the quad maps the node-box rectangle onto a convex quad in
   * node-local space. The source pixels and crop are preserved.
   */
  perspective?: import('./imagePerspective').ImageFillPerspective;
  /**
   * Per-usage animated-media playback settings (v2.20+). Only present on
   * fills whose asset is animated; multiple usages of one asset may carry
   * independent playback settings.
   */
  media?: MediaFillSettings;
}

export interface PatternFillData {
  /** Reference to a tile node id or a data URL of the tile pattern. */
  tileSrc: string;
  /** Tile spacing in px between repetitions. */
  spacing: number;
  /** Rotation of the pattern in degrees. */
  rotation: number;
  /** Tile width in px override. When omitted, natural image width is used. */
  imageWidth?: number;
  /** Tile height in px override. When omitted, natural image height is used. */
  imageHeight?: number;
}

export type FillType = 'solid' | 'gradient' | 'image' | 'pattern';

export interface Fill {
  type: FillType;
  color?: ManagedColor;
  gradient?: GradientFill;
  image?: ImageFillData;
  pattern?: PatternFillData;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
}

/**
 * A first-class, independently-addressable Paint entity (v1.8+).
 *
 * A Paint wraps a Fill with identity (`id`, `name`) so it can be:
 * 1. Referenced by multiple nodes via `paintRefs[]` (paint reuse)
 * 2. Independently updated (changing one Paint updates all consumers)
 * 3. Promoted/demoted between inline `Fill[]` and shared `Paint` status
 *
 * Paint lives in the Document's `paints` map, alongside the existing
 * inline `fills[]` on each node. When a node has `paintRefs`, those paints
 * are resolved from `Document.paints` and used as the node's effective fill
 * stack — replacing the inline `fills`/`fill` for that node.
 *
 * Paint reuse is the key architectural change that decouples "what is painted"
 * from "where it is painted," letting the same image, gradient, or pattern
 * be used as the visual content of any number of nodes while being editable
 * in one place.
 */
export interface Paint {
  id: string;
  name: string;
  /** The fill content (solid, gradient, image, or pattern). */
  fill: Fill;
}

export function makePaint(id: string, name: string, fill: Fill): Paint {
  return { id, name, fill };
}

// ── Property Binding (task 1.2+) ────────────────────────────────────────────

export interface PropertyBinding {
  variableId: string;
  expression?: string;
  /**
   * V2.15+: typed, non-destructive modifier stack applied after the variable
   * resolves (alpha first). Never encoded into `expression` — modifiers are
   * validated, serialized, and migrated as typed records.
   */
  modifiers?: VariableModifier[];
}

// ── Typography types (shared with typography.ts via re-export) ───────────────

export type OpenTypeFeatureTag =
  | 'liga'
  | 'dlig'
  | 'sups'
  | 'subs'
  | 'numr'
  | 'dnom'
  | 'frac'
  | 'afrc'
  | 'zero'
  | 'tnum'
  | 'pnum'
  | 'onum'
  | 'lnum'
  | 'smcp'
  | 'c2sc'
  | 'pcap'
  | 'c2pc'
  | 'unic'
  | 'titl'
  | 'nalt'
  | 'expt'
  | 'fina'
  | 'medi'
  | 'init'
  | 'isol'
  | 'rlig'
  | 'clig'
  | 'calt'
  | 'hlig'
  | 'liga'
  | 'dlig'
  | 'curs'
  | 'mark'
  | 'mkmk'
  | 'locl'
  | 'rclt'
  | 'rvrn'
  | 'kern'
  | 'cpsp'
  | 'case'
  | 'salt'
  | 'ss01'
  | 'ss02'
  | 'ss03'
  | 'ss04'
  | 'ss05'
  | 'ss06'
  | 'ss07'
  | 'ss08'
  | 'ss09'
  | 'ss10'
  | 'ss11'
  | 'ss12'
  | 'ss13'
  | 'ss14'
  | 'ss15'
  | 'ss16'
  | 'ss17'
  | 'ss18'
  | 'ss19'
  | 'ss20'
  | 'cv01'
  | 'cv02'
  | 'cv03'
  | 'cv04'
  | 'cv05'
  | 'cv06'
  | 'cv07'
  | 'cv08'
  | 'cv09'
  | 'cv10'
  | 'cv11'
  | 'cv12'
  | 'cv13'
  | 'cv14'
  | 'cv15'
  | 'aalt'
  | 'abvm'
  | 'blwm'
  | 'ccmp'
  | 'dist';

export type OpenTypeFeatureMap = Partial<Record<OpenTypeFeatureTag, boolean>> & {
  custom?: Record<string, boolean>;
};

export type RegisteredAxisTag = 'wght' | 'wdth' | 'slnt' | 'opsz' | 'ital';

export interface VariableFontAxis {
  tag: string;
  name: string;
  min: number;
  default: number;
  max: number;
  precision?: number;
  isRegistered: boolean;
}

export interface VariableFontInstance {
  name: string;
  coordinates: Record<string, number>;
}

export type VariableFontSettings = Record<string, number>;

export interface CharacterFormat {
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  /**
   * Run text color. ManagedColor since schema 2.13; older documents stored
   * `[r, g, b, a]` sRGB tuples (migrated at load).
   */
  color?: ManagedColor;
  openTypeFeatures?: OpenTypeFeatureMap;
  variableFontSettings?: VariableFontSettings;
  fontVariant?: 'normal' | 'small-caps' | 'all-small-caps';
  baselineShift?: number;
  superscript?: boolean;
  subscript?: boolean;
  kerning?: 'auto' | 'manual' | 'none';
  tracking?: number;
  language?: string;
}

export type TabStopAlignment = 'left' | 'center' | 'right' | 'decimal';

export interface TabStop {
  position: number;
  alignment: TabStopAlignment;
  alignmentChar?: string;
  leader?: string;
}

export interface ParagraphFormat {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  firstLineIndent?: number;
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  listIndent?: number;
  hangingIndent?: boolean;
  hangingQuotes?: boolean;
  hangingLists?: boolean;
  maxLines?: number;
  textOverflow?: 'clip' | 'ellipsis' | 'visible';
  hyphenation?: boolean;
  keepWithNext?: boolean;
  keepTogether?: boolean;
  widowControl?: boolean;
  orphanControl?: boolean;
  dropCapLines?: number;
  dropCapChars?: number;
  direction?: 'ltr' | 'rtl';
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
  columnCount?: number;
  columnGap?: number;
  columnRuleWidth?: number;
  /** Column-rule color. ManagedColor since schema 2.13 (was an sRGB tuple). */
  columnRuleColor?: ManagedColor;
  tabStops?: TabStop[];
  tabSize?: number;
}

export interface TextRun {
  text: string;
  format?: CharacterFormat;
  characterStyleId?: NodeId;
}

export interface Paragraph {
  runs: TextRun[];
  format?: ParagraphFormat;
  paragraphStyleId?: NodeId;
}

export interface RichText {
  paragraphs: Paragraph[];
}

// ── Text Stories (v2.18, ADR-0159) ─────────────────────────────────────────

/**
 * Authoritative story model: one story owns the text content; linked text
 * frames reference it through a thread binding and display derived ranges
 * from composition (M10). The story is the single source of truth — frame
 * text is never duplicated across linked frames.
 */
export interface TextStory {
  id: NodeId;
  name: string;
  /** Authoritative rich-text content. */
  content: RichText;
  /** Ordered frame ids in the thread (paint/composition order). */
  thread: NodeId[];
  /** Language tag for shaping/hyphenation (e.g. "en", "ar"). */
  language?: string;
}

/**
 * A frame's membership in a story thread. Frames without a binding keep
 * their own `richText` (single-frame default, pre-story documents).
 */
export interface TextFrameBinding {
  storyId: NodeId;
  /** Index into the story's thread array. */
  threadIndex: number;
}

/**
 * Per-cluster glyph adjustment for wordmark-level typography.
 *
 * Keyed by grapheme-cluster index (UAX #29, via Intl.Segmenter) in the
 * node's text — NOT by shaped-glyph id or UTF-16 code unit — so adjustments
 * survive font/size/kerning/ligature changes deterministically. Text
 * content edits invalidate the map (policy enforced by the editor).
 */
export interface GlyphAdjustment {
  /** Horizontal offset in px (local space). */
  dx: number;
  /** Vertical offset in px (local space). */
  dy: number;
  /** Advance override in px (adds to the measured cluster advance). */
  advance: number;
  /** Rotation in radians around the cluster origin. */
  rotation: number;
  /** Horizontal scale factor. */
  scaleX: number;
  /** Vertical scale factor. */
  scaleY: number;
}

/** Kerning modes that are actually implemented by the render pipeline. */
export type KerningMode = 'auto' | 'none';

export type TextMode = 'point' | 'area' | 'path' | 'auto';

export interface PathTextSettings {
  pathNodeId: NodeId;
  startOffset?: number;
  endOffset?: number;
  side?: 'top' | 'bottom';
  flip?: boolean;
  baselineShift?: number;
  /**
   * Stretch or squeeze inter-cluster tracking so each line spans the
   * usable interval exactly. Glyph shapes are never distorted; spacing
   * absorbs the difference. Off by default — path layout always clips.
   */
  fitToPath?: boolean;
  /**
   * Reverse the visual reading direction: glyphs are placed from the end
   * of the usable interval toward the start and each glyph's tangent
   * angle is flipped by π. Combined with `side`, this lets bottom-of-circle
   * text read left-to-right in the normal orientation, which is the
   * standard for badges and seals.
   */
  reverse?: boolean;
}

export type AdaptiveContrastPolicy = 'wcag-aa' | 'wcag-aaa' | 'custom';

export interface AdaptiveContrastState {
  enabled: boolean;
  policy: AdaptiveContrastPolicy;
  lightColor?: ManagedColor;
  darkColor?: ManagedColor;
  customRatio?: number;
  hysteresis?: number;
  lastResolved?: number;
  resolvedColor?: ManagedColor;
}

export type AdjustmentScope =
  | { mode: 'image-local'; targetNodeId: NodeId }
  | { mode: 'explicit-targets'; targetNodeIds: NodeId[] }
  | { mode: 'container-descendant'; containerId: NodeId; includeNested: boolean }
  | { mode: 'document' };

// ── Base node ───────────────────────────────────────────────────────────────

export interface NodeBase {
  id: NodeId;
  name: string;
  /** Optional 7-color layer tag (Photoshop/Affinity-style). Null = no tag. */
  layerColor?: LayerColor;
  fill: ManagedColor;
  /** P2: stacked fills (solid/gradient/image). When present, takes precedence over `fill`. */
  fills?: Fill[];
  /**
   * V1.8+: Ordered references to shared Paint entities on the Document.
   * When present, these paints are resolved from `Document.paints` and used
   * as the node's effective fill stack, replacing `fills`/`fill` for this node.
   * Each entry is a Paint ID.
   */
  paintRefs?: string[];
  /**
   * Paint order among siblings (0 = bottom). Reorder via Document.move.
   * @deprecated Use `order` (fractional-indexing) instead. This field is set at
   * creation time but never updated by reorder operations — it is vestigial.
   */
  index?: number;
  /** Fractional-indexing order key for CRDT-safe concurrent ordering. */
  order: string;
  visible: boolean;
  locked: boolean;
  /**
   * Solo view: when any node in the document is soloed, only soloed nodes are
   * effectively visible (all others are hidden for display). Reversible and
   * undo-friendly — it is just a boolean flag, never a destructive mutation.
   */
  solo?: boolean;
  /** F6: layer opacity 0-1 (default 1). */
  opacity: number;
  /** F6: CSS blend mode (default 'normal'). */
  blendMode: BlendMode;
  /** F6: rotation in degrees (default 0). Applied to transform on render. */
  rotation: number;
  /**
   * F6: optional variable bindings per property.
   * Keyed by property name (e.g. "fill", "opacity", "x", "y", "width",
   * "height", "rotation", "fontSize", "strokeWeight").
   */
  bindings?: Record<string, PropertyBinding>;
  /** P3: min/preferred/max width for clamp sizing. */
  minWidth?: number;
  preferredWidth?: number;
  maxWidth?: number;
  /** P3: min/preferred/max height for clamp sizing. */
  minHeight?: number;
  preferredHeight?: number;
  maxHeight?: number;
  /** P3: how this node is sized within its parent's auto-layout. */
  layoutSizing?: LayoutSizing;
  /** Width sizing within a layout parent. Falls back to layoutSizing for old documents. */
  layoutSizingWidth?: LayoutSizing;
  /** Height sizing within a layout parent. Falls back to layoutSizing for old documents. */
  layoutSizingHeight?: LayoutSizing;
  /** Whether this node participates in its parent's flow layout. */
  layoutPosition?: LayoutPosition;
  /** Optional cross-axis alignment override for a flow child. */
  layoutAlign?: LayoutAlign;
  /** P3: grid item placement within a grid parent. */
  gridPlacement?: GridItemPlacement;
  /** Figma-style constraints for responsive child positioning within frames. */
  constraints?: Constraints;
  /** Export presets for this node. */
  presets?: ExportPreset[];
  /** Reference to a reusable style definition. */
  styleId?: NodeId;
  /** Property overrides applied on top of the referenced style. */
  styleOverrides?: Record<string, unknown>;
  /** When true, this node is excluded from snapping calculations. */
  snapExcluded?: boolean;
  /** Native non-destructive mask. Leaf image shapes may own raster masks. */
  mask?: Mask;
  /**
   * Reference to a `Document.iconAssets` entry (v2.x icon system). When set,
   * the node is an icon instance: its visual content was derived from the
   * asset's sanitized SVG and the node carries icon provenance (provider,
   * licence, attribution, variant). Clearing the reference (detach) turns
   * the node into a plain editable group with no icon semantics.
   */
  iconAssetId?: string;
  /**
   * V2.16+: ordered, non-destructive geometry-modifier (warp) stack.
   *
   * The canonical source geometry is never rewritten; disabling or removing
   * these restores the exact source. Controls are normalized to the source
   * bounds unless a modifier sets `coordinateSpace: 'source-local'`. Only
   * shape/text/group/frame nodes may carry warps (see warpOps).
   */
  warps?: WarpModifier[];
  /** V2.16+: evaluation settings for the warp stack (quality/strokes/etc). */
  warpSettings?: WarpSettings;
  /**
   * Object-local nondestructive filter stack. Entries are evaluated in array
   * order against this node's rendered result; unlike AdjustmentNode entries,
   * these filters do not create a separate scene node or backdrop scope.
   */
  smartFilters?: Adjustment[];
  /** Stack-level bypass for Object Filters; absent is enabled for compatibility. */
  smartFiltersEnabled?: boolean;
}

export interface ShapeNode extends NodeBase {
  kind: 'shape';
  /** Geometry in local coordinates. When `shapeless` is true, geometry is
   *  derived from the node's paint (e.g. image natural dimensions) and this
   *  field may still hold a fallback/sentinel rect for backward compat. */
  shape: Shape;
  /**
   * V1.8+: When true, this node's geometry is derived from its paint rather
   * than from the explicit `shape` field. For an image paint, the geometry is
   * the image's natural dimensions. For solid/gradient paints, it's a 100×100
   * default rect.
   *
   * This is the mechanism that makes images first-class objects: a shapeless
   * ShapeNode with an image paint IS an image — its bounds come from the image
   * content, not from a host shape that clips it. The node still supports all
   * ShapeNode features (transform, effects, strokes, blend modes, masks).
   *
   * Backward compatible: existing nodes always have shapeless=false/undefined.
   */
  shapeless?: boolean;
  transform: Affine;
  /** F6: stacked strokes. */
  strokes: Stroke[];
  /** F6: stacked effects (shadows, blurs). */
  effects: Effect[];
  /** Uniform or per-corner radius for rect-anchored shapes. */
  cornerRadius?: number | [number, number, number, number];
  /** Corner smoothing percentage (0-100), Sketch-style continuous corners. */
  cornerSmoothing?: number;
  /** Background removal mask applied to this shape's image fill. */
  backgroundRemoval?: BackgroundRemovalState;
  /** Live trace state for nondestructive raster-to-vector workflow. */
  liveTrace?: LiveTraceState;
}

export interface TextNode extends NodeBase {
  kind: 'text';
  text: string;
  transform: Affine;
  /** Local text-container width. Present for area/fixed text, omitted for point text. */
  w?: number;
  /** Local text-container height. Present for area/fixed text, omitted for point text. */
  h?: number;
  /** Font size in px at 1x; variable-bindable across breakpoints (task 1.3). */
  fontSize: number;
  /** F6: font family — CSS-safe name or exact font. */
  fontFamily?: string;
  /** F6: font weight as CSS numeric or keyword. */
  fontWeight?: number;
  /** F6: font style (normal/italic). */
  fontStyle?: 'normal' | 'italic';
  /** F6: line-height multiplier. */
  lineHeight?: number;
  /** F6: letter-spacing in px. */
  letterSpacing?: number;
  /** Typographic tracking in 1/1000 em units, added between glyphs. */
  tracking?: number;
  /** F6: paragraph spacing in px. */
  paragraphSpacing?: number;
  /** F6: text alignment. */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  /** F6: vertical text alignment. */
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  /** F6: text transform. */
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** F6: text decoration. */
  textDecoration?: 'none' | 'underline' | 'line-through';
  /** F6: list style for multi-line text. */
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  /** F6: text truncation/overflow behaviour. */
  textOverflow?: 'clip' | 'ellipsis' | 'visible';
  /** F6: resizing mode — auto-width/auto-height/fixed. */
  textResizing?: 'autoWidth' | 'autoHeight' | 'fixed';
  /** F6: OpenType feature flags (stub — e.g. { liga: true, kern: true }). */
  openTypeFeatures?: Record<string, boolean>;
  /**
   * Kerning mode. 'auto' uses font pair kerning (browser/rustybuzz default).
   * 'none' disables pair kerning between clusters while tracking, manual
   * pair adjustments, and ligature behavior remain independent.
   */
  kerningMode?: KerningMode;
  /**
   * Per-cluster glyph adjustments keyed by grapheme-cluster index. When
   * present, the renderer draws cluster-by-cluster so offsets, rotations,
   * and scales apply without corrupting ordinary text behavior.
   */
  glyphAdjustments?: Record<number, GlyphAdjustment>;
  /**
   * Manual pair spacing: px of extra space between cluster i and cluster
   * i+1, keyed by the index of the preceding cluster. Applies in both
   * kerning modes.
   */
  pairAdjustments?: Record<number, number>;
  /** Variable font axis values (e.g. { wght: 500, wdth: 75 }). */
  variableAxes?: Record<string, number>;
  /** Rich text content (paragraphs with runs). When set, overrides `text`. */
  richText?: RichText;
  /** Story thread membership (v2.18, ADR-0159); absent for single-frame text. */
  storyBinding?: TextFrameBinding;
  /** Text mode: point, area, path, or auto. */
  textMode?: TextMode;
  /** Path text settings (when textMode === 'path'). */
  pathTextSettings?: PathTextSettings;
  /** Text direction: 'ltr', 'rtl', or 'auto' (auto-detect from content). */
  direction?: 'ltr' | 'rtl' | 'auto';
  /** ISO language tag for language-specific shaping (e.g. 'ar', 'hi', 'th'). */
  language?: string;
  /** F6: stacked strokes on text. */
  strokes: Stroke[];
  /** F6: stacked effects on text. */
  effects: Effect[];
  /** Phase 5: Reference to a path/vector node whose shape the text follows. */
  pathId?: NodeId;
  /** Phase 5: 0-1 offset along the path to start text (default 0). */
  pathOffset?: number;
  /** Phase 5: Which side of the path text appears on. */
  pathSide?: 'top' | 'bottom';
  /**
   * Adaptive contrast settings for automatic text colour adjustment.
   * When enabled, the rendered text colour is adjusted to meet WCAG contrast
   * targets against the composited backdrop, while the stored fill remains
   * the author's original choice.
   */
  adaptiveContrast?: AdaptiveContrastState;
}

export interface GroupNode extends NodeBase {
  kind: 'group';
  transform: Affine;
  /** Child node ids in paint order. */
  children: NodeId[];
  /**
   * When true, the group composites as an isolated group (backdrop is
   * transparent black). Default false (non-isolated = pass-through behavior
   * for normal blend mode). Per W3C isolated group behavior §8.3:
   * "An isolated group is one whose elements are composited onto a
   * transparent black initial backdrop."
   */
  isolated?: boolean;
  /** Effects applied to the group as a whole (shadows, blurs, glows). */
  effects: Effect[];
  /**
   * Lightweight provenance for groups created by Image Trace. Enables the
   * Edit Trace / Re-trace workflow: the dialog can be reopened pre-filled
   * with the original options, and re-traces replace this group in place.
   * Deliberately stores no image bytes — only the source node id and a
   * content hash for staleness checks.
   */
  traceMetadata?: TraceMetadata;
}

/**
 * Versioned provenance for a traced group (see `GroupNode.traceMetadata`).
 * Stored on the group so it survives save/load and undo without embedding
 * raster data in the metadata.
 */
export interface TraceMetadata {
  schemaVersion: 1;
  /** The image node this trace was generated from. */
  sourceNodeId: NodeId;
  /** Content hash of the source pixels at trace time (sha256 hex), when known. */
  sourceHash?: string;
  /** Trace mode: monochrome outline / grayscale / limited color / pixel art. */
  mode: 'monochrome' | 'grayscale' | 'color' | 'pixel-art';
  /** Filled silhouette vs stroked centerline. */
  traceMode: 'silhouette' | 'centerline';
  threshold: number;
  foreground: 'dark' | 'light';
  alphaThreshold: number;
  minArea: number;
  simplifyTolerance: number;
  maxPaths: number;
  maxColors: number;
  compoundHoles: boolean;
  cornerAngle: number;
  centerlineWidth: number;
  centerlinePrune: number;
  /** Which engine produced the result (native Rust / TS worker / WASM). */
  engine: 'native' | 'worker' | 'wasm' | 'direct';
  /** Result statistics at trace time. */
  stats: {
    pathCount: number;
    pointCount: number;
    holeCount: number;
    omittedHoles: number;
  };
  /** Milliseconds spent tracing (engine time only, informational). */
  traceMs?: number;
  createdAt: number;
}

/** B2: TypeScript mirror of strata-layout LayoutStyle (Rust). */
export type LayoutMode = 'flex' | 'grid';
export type FlexDirection = 'row' | 'column' | 'rowReverse' | 'columnReverse';

export interface LayoutStyle {
  mode: LayoutMode;
  direction: FlexDirection;
  gap: number;
  wrap: boolean;
  /** [top, right, bottom, left] in px. */
  padding: [number, number, number, number];
  grow: number;
  shrink: number;
  /** F6: alignment and justification. */
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  /** P3: Grid template columns (e.g., "1fr 200px 1fr", "repeat(3, 1fr)"). */
  gridTemplateColumns?: string;
  /** P3: Grid template rows (e.g., "auto 1fr auto"). */
  gridTemplateRows?: string;
  /** P3: Grid auto-flow: "row" | "column" | "row-dense" | "column-dense". */
  gridAutoFlow?: 'row' | 'column' | 'rowDense' | 'columnDense';
  /** P3: Row gap (separate from `gap` for grid). */
  rowGap?: number;
  /** P3: Column gap (separate from `gap` for grid). */
  columnGap?: number;
}

/** How a child is sized within its parent's auto-layout. */
export type LayoutSizing = 'fixed' | 'hug' | 'fill';
export type LayoutPosition = 'flow' | 'absolute';
export type LayoutAlign = 'inherit' | 'start' | 'center' | 'end' | 'stretch';

/** Grid item placement (column/row start/end or span). */
export interface GridItemPlacement {
  gridColumnStart?: number;
  gridColumnEnd?: number;
  gridRowStart?: number;
  gridRowEnd?: number;
}

export interface FrameNode extends NodeBase {
  kind: 'frame';
  transform: Affine;
  /** Frame width in world-space px. Set at creation; updated by resize. */
  w: number;
  /** Frame height in world-space px. Set at creation; updated by resize. */
  h: number;
  /** Child node ids in paint order. Slot bindings (task 1.1) extend this. */
  children: NodeId[];
  /** If this frame is a component instance, the component it instantiates. */
  componentId?: NodeId;
  /** Slot fills: slotId -> child NodeId (filled in task 1.1). */
  slots?: Record<string, NodeId>;
  /** B2: CSS layout properties (Taffy-backed). */
  layoutStyle?: LayoutStyle;
  /** Toggle clipping of children outside the frame bounds. Default true. */
  clipContent?: boolean;
  /** Active variant id for this component instance. */
  variant?: string;
  /** Per-property overrides on top of the variant/base component. */
  propertyOverrides?: Record<string, string | boolean | NodeId>;
  /** Last-synced property snapshot for override detection (component instances). */
  syncBaseline?: Record<string, unknown>;
  /** Mockup presentation instance (v2.16+). See mockup/types.ts. */
  mockup?: import('./mockup/types').MockupInstanceData;
  /** F6: strokes on frame. */
  strokes: Stroke[];
  /** F6: effects on frame. */
  effects: Effect[];
  /** Uniform or per-corner radius for frame corners. */
  cornerRadius?: number | [number, number, number, number];
  /** Corner smoothing percentage (0-100, Sketch-style continuous corners). */
  cornerSmoothing?: number;
}

/**
 * V2.15+: native responsive table (ADR-0016).
 *
 * A table is a semantic document capability, not a collection of frames.
 * Content is data-backed (cells are lightweight records with stable ids);
 * the render layer compiles the model into grid primitives per frame and the
 * persistent document never flattens it. Row/column/cell ids are stable
 * across edits, spans, reordering, undo, clipboard round trips, and
 * collaboration.
 */
export interface TableNode extends NodeBase {
  kind: 'table';
  transform: Affine;
  /** Table frame width (the layout target; tracks resolve against it). */
  w: number;
  /** Table frame height. */
  h: number;
  table: TableModel;
  /** Clip cell content to the table bounds. Default true. */
  clipContent?: boolean;
  /** F6: strokes on the table frame. */
  strokes: Stroke[];
  /** F6: effects on the table frame. */
  effects: Effect[];
  cornerRadius?: number;
  cornerSmoothing?: number;
}

// ── Background Removal Types ─────────────────────────────────────────────────

export type BackgroundRemovalMethod = 'quick' | 'ai-balanced' | 'ai-quality';

export interface BackgroundRemovalState {
  maskDataUrl: string;
  method: BackgroundRemovalMethod;
  confidence: number;
  appliedAt: number;
  feather?: number;
  decontaminate?: boolean;
}

// ── Live Trace Types ─────────────────────────────────────────────────────────

export interface LiveTraceParams {
  mode: 'monochrome' | 'grayscale' | 'color' | 'pixel-art';
  threshold: number;
  foreground: 'dark' | 'light';
  alphaThreshold: number;
  minArea: number;
  simplifyTolerance: number;
  maxPaths: number;
  maxColors: number;
  compoundHoles: boolean;
  /** Schema version. 1 = pre-overhaul (no bezier/centerline). 2 = current. */
  traceVersion?: number;
  /** Trace mode: silhouette (filled paths) or centerline (stroked paths). */
  traceMode?: 'silhouette' | 'centerline';
  /** Interior angle threshold for sharp corners (degrees, 90-180). Default 135. */
  cornerAngle?: number;
  /** Maximum Bezier fitting error in pixels (0.1-10). Default 1.0. */
  maxError?: number;
  /** Target stroke width for centerline mode in pixels (1-50). Default 2. */
  centerlineWidth?: number;
  /** Minimum branch length to keep for centerline mode in pixels (1-100). Default 4. */
  centerlinePrune?: number;
}

const CURRENT_TRACE_VERSION = 2;

export function defaultLiveTraceParams(): LiveTraceParams {
  return {
    mode: 'monochrome',
    threshold: 128,
    foreground: 'dark',
    alphaThreshold: 1,
    minArea: 4,
    simplifyTolerance: 0.75,
    maxPaths: 1000,
    maxColors: 8,
    compoundHoles: true,
    traceVersion: CURRENT_TRACE_VERSION,
    traceMode: 'silhouette',
    cornerAngle: 135,
    maxError: 1.0,
    centerlineWidth: 2,
    centerlinePrune: 4,
  };
}

/** Migrate LiveTraceParams from older schema versions to the current one. */
export function migrateLiveTraceParams(params: Partial<LiveTraceParams>): Partial<LiveTraceParams> {
  const version = params.traceVersion ?? 1;
  if (version >= CURRENT_TRACE_VERSION) return params;
  const migrated = { ...params, traceVersion: CURRENT_TRACE_VERSION };
  if (version < 2) {
    if (migrated.traceMode === undefined) migrated.traceMode = 'silhouette';
    if (migrated.cornerAngle === undefined) migrated.cornerAngle = 135;
    if (migrated.maxError === undefined) migrated.maxError = 1.0;
    if (migrated.centerlineWidth === undefined) migrated.centerlineWidth = 2;
    if (migrated.centerlinePrune === undefined) migrated.centerlinePrune = 4;
  }
  return migrated;
}

export interface LiveTraceState {
  sourceNodeId: NodeId;
  params: LiveTraceParams;
  resolvedAt: number | null;
  lastError: string | null;
  /** ID of the generated vector group that visually replaces the source while live trace is active. */
  traceGroupId?: NodeId;
}

/** @deprecated Use ShapeNode with imageFill(). ImageNode no longer exists as a distinct node kind. */
export type ImageNode = ShapeNode;

// ── Adjustment Layer Types (Phase 1) ─────────────────────────────────────────

export type AdjustmentType = 'curves' | 'levels' | 'selectiveColor' | 'hsl' | 'exposure';

export interface AdjustmentCurvesPoint {
  x: number;
  y: number;
}

export interface AdjustmentCurves {
  channel: 'rgb' | 'red' | 'green' | 'blue';
  points: AdjustmentCurvesPoint[];
}

export interface AdjustmentLevels {
  channel: 'rgb' | 'red' | 'green' | 'blue';
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}

export type SelectiveColorTarget =
  | 'red'
  | 'green'
  | 'blue'
  | 'cyan'
  | 'magenta'
  | 'yellow'
  | 'white'
  | 'neutral'
  | 'black';

export interface AdjustmentSelectiveColor {
  color: SelectiveColorTarget;
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
  method: 'absolute' | 'relative';
}

export type AdjustmentParams = AdjustmentCurves | AdjustmentLevels | AdjustmentSelectiveColor;

export interface AdjustmentNode extends NodeBase {
  kind: 'adjustment';
  adjustmentType: AdjustmentType;
  params: AdjustmentParams;
  transform: Affine;
  /** When true, only affects the layer directly below this adjustment.
   *  @deprecated Use `scope` field instead (v2.3+). This field is read
   *  during migration and during legacy scope resolution when `scope` is absent. */
  clipping: boolean;
  effects: Effect[];
  /** Nondestructive adjustment entries applied in sequence. */
  adjustments?: Adjustment[];
  /**
   * V2.3+: Explicit targeting scope that determines which nodes this
   * adjustment affects. When absent, legacy clipping-mode resolution is used
   * (sibling-below in paint order).
   *
   * See `AdjustmentScope` in `./adjustmentScope` for mode definitions.
   */
  scope?: AdjustmentScope;
}

// ── Vector Path Node ─────────────────────────────────────────────────────────

/** @deprecated Use ShapeNode with kind:'path' shape instead. PathNode is
 *  preserved for backward compatibility with serialized documents. */
export interface PathNode extends NodeBase {
  kind: 'path';
  /** Control points in node-local coordinates. */
  points: PathPoint[];
  /** Whether the last point connects back to the first. */
  closed: boolean;
  transform: Affine;
  strokes: Stroke[];
  effects: Effect[];
}

// ── Raster Layer Node ─────────────────────────────────────────────────────────

export interface RasterTile {
  /** RGBA pixel data (128 * 128 * 4 bytes per tile). */
  pixels: Uint8ClampedArray;
  /** Monotonic version for cache invalidation. */
  version: number;
}

export interface RasterLayerNode extends NodeBase {
  kind: 'rasterLayer';
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Whether to constrain drawing to pixel grid. */
  pixelMode: boolean;
  /** Tile storage: key = "{col}:{row}" in 128×128 grid. */
  tiles: Map<string, RasterTile>;
  /** Local transform for positioning/rotation/scale. */
  transform: Affine;
}

export type SceneNode =
  | ShapeNode
  | TextNode
  | GroupNode
  | FrameNode
  | TableNode
  | AdjustmentNode
  | PathNode
  | RasterLayerNode;

export type ContainerNode = GroupNode | FrameNode;

/** True if the node is a container (has a children array). */
export function isContainer(node: SceneNode): node is ContainerNode {
  return node.kind === 'frame' || node.kind === 'group';
}

/** True if the node is a native table. */
export function isTableNode(node: SceneNode): node is TableNode {
  return node.kind === 'table';
}

// ── Document base type ──────────────────────────────────────────────────────
/**
 * Minimal document shape shared across scene modules without importing the
 * full `Document` type from `./document` (which would create import cycles).
 * `Document` extends this interface.
 */

// ---------------------------------------------------------------------------
// Logo project (v2.12+)
// ---------------------------------------------------------------------------

export type LogoConceptStatus = 'active' | 'pinned' | 'rejected' | 'archived';

export type LogoVariantKind =
  | 'primary'
  | 'horizontal'
  | 'vertical'
  | 'stacked'
  | 'compact'
  | 'icon'
  | 'wordmark'
  | 'monochrome'
  | 'reversed'
  | 'small'
  | 'favicon'
  | 'app-icon'
  | 'avatar'
  | 'watermark'
  | 'custom';

export type LogoProvenance =
  | 'user-created'
  | 'imported'
  | 'template-derived'
  | 'generated-locally'
  | 'generated-remotely'
  | 'vectorized'
  | 'reconstructed'
  | 'derived';

export interface LogoBrief {
  brandName?: string;
  tagline?: string;
  industry?: string;
  audience?: string;
  keywords: string[];
  preferredColors: string[];
  prohibitedColors: string[];
  notes?: string;
  updatedAt: number;
}

export interface LogoConcept {
  id: string;
  name: string;
  artboardId: NodeId | null;
  status: LogoConceptStatus;
  rationale?: string;
  provenance: LogoProvenance;
  createdAt: number;
  updatedAt: number;
  sourcePrompt?: string;
}

export interface LogoVariant {
  id: string;
  name: string;
  kind: LogoVariantKind;
  artboardId: NodeId | null;
  sourceConceptId: string | null;
  derivedFromVariantId: string | null;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LogoPaletteColor {
  id: string;
  name?: string;
  color: ManagedColor;
  role?: string;
}

export interface LogoPalette {
  colors: LogoPaletteColor[];
  updatedAt: number;
}

export interface LogoProject {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  brief: LogoBrief;
  concepts: LogoConcept[];
  variants: LogoVariant[];
  palette?: LogoPalette;
}

export interface DocumentBase {
  nodes: Record<NodeId, SceneNode>;
  nextId: number;
  components: Record<NodeId, ComponentDefinition>;
  styles?: Record<string, Style>;
  installedLibraries?: Array<{
    id: string;
    name: string;
    version: string;
    installedAt: string;
  }>;
}

// ── Page type ────────────────────────────────────────────────────────────────

export interface Page {
  id: NodeId;
  name: string;
  width: number;
  height: number;
  /** Stable fractional-indexing order key for page sequencing. */
  order: PageOrder;
  /** Per-page bleed override (inherits from Document.bleed when unset). */
  bleed?: BleedConfig;
  /** Per-page safe area override (inherits from Document.safeArea when unset). */
  safeArea?: SafeAreaConfig;
  /** Per-page slug override (inherits from Document.slug when unset). */
  slug?: SlugConfig;
  /** Page-level background shape layer ids (rendered behind content). */
  backgrounds: NodeId[];
  /** Group node id that holds all page content as children. */
  contentRoot: NodeId;
  /** Optional ruler origin offset within the page (artboard-local px). */
  rulerOrigin?: { x: number; y: number };
  /** ID of the master page applied to this page (unset = no master). */
  masterPageId?: NodeId;
  /** Per-node overrides against the applied master. Keyed by master node ID. */
  masterOverrides?: Record<NodeId, MasterOverride>;
  /** Print/export settings for this page. */
  printSettings?: PagePrintSettings;
  /**
   * Pasteboard placement (world/pasteboard coordinates of the trim box
   * top-left). Absent = resolved deterministically by the pasteboard layout
   * engine. Placement is layout metadata, never content: moving a page must
   * not mutate any node transform (ADR-0124).
   */
  placement?: PagePlacement;
}

// ── Page ordering ──────────────────────────────────────────────────────────────

/** Stable ordering key for pages (fractional-indexing). */
export type PageOrder = string;

// ── Pasteboard placement ───────────────────────────────────────────────────────

/** World/pasteboard coordinates of a page or spread origin (top-left). */
export interface PagePlacement {
  x: number;
  y: number;
}

// ── Page side classification ──────────────────────────────────────────────────

/** Left/right page classification for facing-page spreads. */
export type PageSide = 'left' | 'right' | 'none';

// ── Master pages ──────────────────────────────────────────────────────────────

export type MasterAppliesTo = 'all' | 'left' | 'right';

export interface MasterPage {
  id: NodeId;
  name: string;
  width: number;
  height: number;
  /** Group node that holds all master content as children. */
  contentRoot: NodeId;
  /** Whether this master applies to all, left, or right pages. */
  appliesTo: MasterAppliesTo;
  /** Optional description shown in the masters panel. */
  description?: string;
}

// ── Arrange operations ─────────────────────────────────────────────────────────

export type ArrangeOp = 'front' | 'back' | 'forward' | 'backward';

/** How a node is overridden on a derived page. */
export type MasterOverrideType = 'modified' | 'hidden' | 'deleted';

export interface MasterOverride {
  /** ID of the master's node that is being overridden. */
  masterNodeId: NodeId;
  /** Type of override. */
  type: MasterOverrideType;
  /** When type='modified': the replacement node (a local copy with changes). */
  localNodeId?: NodeId;
  /** When type='hidden': the node is invisible on this page. */
}

// ── Editorial spreads ─────────────────────────────────────────────────────────

/** Spread topology kind (ADR-0128/0129). */
export type SpreadKind = 'single' | 'facing' | 'foldout' | 'custom';

export interface Spread {
  id: NodeId;
  /** One page (single-page spread) or two pages (facing-page spread). */
  pageIds: [NodeId] | [NodeId, NodeId];
  /** Spread-level guides. */
  guides?: Guide[];
  /** Topology kind; absent = derived from facing-pages config. */
  kind?: SpreadKind;
  /**
   * Pasteboard placement of the spread origin (top-left of the first page).
   * Absent = resolved from member page placement or the layout engine
   * (ADR-0124).
   */
  placement?: PagePlacement;
}

// ── Facing pages configuration ────────────────────────────────────────────────

export interface FacingPagesConfig {
  enabled: boolean;
  /** Whether the first page is on the right side (default true). */
  startOnRight: boolean;
  /** Whether a blank page is inserted to ensure the first page is right-side. */
  autoInsertBlank?: boolean;
  /** Binding direction (default ltr); mirrors side classification (ADR-0129). */
  bindingDirection?: 'ltr' | 'rtl';
}

/**
 * Spread persistence model (ADR-0128):
 * - `derived`: spreads are a pure projection of page order (default).
 * - `custom`: spreads are user-authored records with stable ids; the derived
 *   projection never overwrites them.
 */
export type SpreadModel = 'derived' | 'custom';

// ── Page numbering and sections ───────────────────────────────────────────────

export type PageNumberStyle = 'decimal' | 'upperRoman' | 'lowerRoman' | 'upperAlpha' | 'lowerAlpha';

export interface PageSection {
  id: NodeId;
  name: string;
  /** Page order key where this section begins. */
  startPageOrder: PageOrder;
  /** Numbering style for this section. */
  numberStyle: PageNumberStyle;
  /** Starting page number (1-indexed; default 1). */
  startNumber: number;
  /** Whether page numbers are shown on pages in this section. */
  showPageNumber: boolean;
  /** Optional prefix before the number (e.g. "A-" for appendix). */
  prefix?: string;
}

// ── Print/Export settings (per-page overrides) ─────────────────────────────────

export interface PagePrintSettings {
  /** Whether this page is excluded from export. */
  excludeFromExport?: boolean;
  /** Per-page DPI override. */
  dpiOverride?: number;
  /** Per-page rotation for export (degrees, 0/90/180/270). */
  exportRotation?: 0 | 90 | 180 | 270;
}

export type SlotKind = 'single' | 'multiple' | 'text';

export interface Slot {
  id: string;
  name: string;
  kind: SlotKind;
  /** Optional default content (NodeId of a node used as the default fill). */
  defaultContentId?: NodeId;
}

// ── Component Properties & Variants (Phase 3) ──────────────────────────────

export type ComponentPropertyType = 'text' | 'boolean' | 'instanceSwap' | 'variant';

export interface ComponentProperty {
  id: string;
  name: string;
  type: ComponentPropertyType;
  defaultValue: string | boolean | NodeId;
}

export interface Variant {
  id: string;
  name: string;
  /** Overrides for component properties. Only properties with values different
   *  from defaults need to be specified. */
  propertyValues: Record<string, string | boolean | NodeId>;
}

export interface PropertySet {
  id: string;
  name: string;
  propertyNames: string[];
}

export interface ComponentDefinition {
  id: NodeId;
  name: string;
  /** Typed slots this component accepts. */
  slots: Slot[];
  /** Root of the master tree (the synchronized template). */
  masterRootId: NodeId;
  /** Component properties for this component. */
  properties?: ComponentProperty[];
  /** Named variants that set multiple properties at once. */
  variants?: Variant[];
  /** Groups of properties that define variant axes. */
  propertySets?: PropertySet[];
}

// ── Reusable Style Types ─────────────────────────────────────────────────────

export type StyleType = 'color' | 'text' | 'effect' | 'layout';

export interface ColorStyle {
  id: NodeId;
  type: 'color';
  name: string;
  fill: Fill;
  description?: string;
}

export interface TextStyle {
  id: NodeId;
  type: 'text';
  name: string;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  paragraphSpacing?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  description?: string;
}

export interface EffectStyle {
  id: NodeId;
  type: 'effect';
  name: string;
  effects: Effect[];
  description?: string;
}

export interface LayoutStyleDef {
  id: NodeId;
  type: 'layout';
  name: string;
  layout: LayoutStyle;
  description?: string;
}

export type Style = ColorStyle | TextStyle | EffectStyle | LayoutStyleDef;

// ── Shape geometry helpers for Inspector F6 ─────────────────────────────────

/** Extract width from a Shape, returning 0 for non-sizeable shape kinds. */
export function shapeWidth(shape: Shape): number {
  switch (shape.kind) {
    case 'table':
      return shape.w;
    case 'rect':
      return shape.w;
    case 'ellipse':
      return shape.rx * 2;
    case 'circle':
      return shape.r * 2;
    case 'polygon':
      return shape.radius * 2;
    case 'star':
      return shape.outerRadius * 2;
    case 'line':
      return Math.abs(shape.to[0] - shape.from[0]);
    case 'arrow':
      return Math.abs(shape.to[0] - shape.from[0]);
    case 'path': {
      if (shape.points.length === 0) return 0;
      const xs = shape.points.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    }
  }
}

/** Extract height from a Shape. */
export function shapeHeight(shape: Shape): number {
  switch (shape.kind) {
    case 'table':
      return shape.h;
    case 'rect':
      return shape.h;
    case 'ellipse':
      return shape.ry * 2;
    case 'circle':
      return shape.r * 2;
    case 'polygon':
      return shape.radius * 2;
    case 'star':
      return shape.outerRadius * 2;
    case 'line':
      return Math.abs(shape.to[1] - shape.from[1]);
    case 'arrow':
      return Math.abs(shape.to[1] - shape.from[1]);
    case 'path': {
      if (shape.points.length === 0) return 0;
      const ys = shape.points.map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    }
  }
}

// ── Image crop + transform validation ──────────────────────────────────────

/** Clamp a crop rect to be within the source image bounds. */
export function clampImageCropRect(
  crop: ImageCropRect,
  sourceWidth: number,
  sourceHeight: number,
): ImageCropRect {
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  const x = Math.max(0, Math.min(crop.x, sw - 1));
  const y = Math.max(0, Math.min(crop.y, sh - 1));
  const w = Math.max(1, Math.min(crop.w, sw - x));
  const h = Math.max(1, Math.min(crop.h, sh - y));
  return { x, y, w, h };
}

/** Returns true if the crop rect covers the entire source image (or is degenerate). */
export function isFullImageCrop(
  crop: ImageCropRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  if (!crop) return true;
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  return crop.x <= 0 && crop.y <= 0 && crop.w >= sw && crop.h >= sh;
}

/** Validate and normalize an image crop rect. Returns undefined for full-image crops. */
export function normalizeImageCropRect(
  crop: ImageCropRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): ImageCropRect | undefined {
  if (!crop) return undefined;
  if (
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !Number.isFinite(crop.w) ||
    !Number.isFinite(crop.h)
  ) {
    return undefined;
  }
  const clamped = clampImageCropRect(crop, sourceWidth, sourceHeight);
  if (isFullImageCrop(clamped, sourceWidth, sourceHeight)) return undefined;
  return clamped;
}

/** Validate image rotation is finite. Normalizes to [0, 360). */
export function normalizeImageRotation(rotation: number | undefined): number | undefined {
  if (rotation === undefined) return undefined;
  if (!Number.isFinite(rotation)) return undefined;
  // Normalize to [0, 360) to avoid drift
  const normalized = ((rotation % 360) + 360) % 360;
  // Snap near-zero to 0
  if (Math.abs(normalized) < 1e-6 || Math.abs(normalized - 360) < 1e-6) return 0;
  return normalized;
}

function isImageFit(value: unknown): value is ImageFit {
  return (
    value === 'fill' ||
    value === 'fit' ||
    value === 'stretch' ||
    value === 'tile' ||
    value === 'crop'
  );
}

/**
 * Normalize persisted per-usage image geometry.
 *
 * This is intentionally independent from document-version migrations: malformed
 * values can also enter a current-version document through plugins, clipboard
 * data, or hand-edited JSON. Optional source dimensions remain optional for
 * legacy fills, but when present they must be positive finite values.
 */
export function normalizeImageFillData(
  image: ImageFillData,
  source?: { width?: number; height?: number },
): ImageFillData {
  const sourceWidth =
    Number.isFinite(source?.width) && (source?.width as number) > 0 ? source?.width : undefined;
  const sourceHeight =
    Number.isFinite(source?.height) && (source?.height as number) > 0 ? source?.height : undefined;
  const imageWidth =
    sourceWidth ??
    (Number.isFinite(image.imageWidth) && (image.imageWidth as number) > 0
      ? image.imageWidth
      : undefined);
  const imageHeight =
    sourceHeight ??
    (Number.isFinite(image.imageHeight) && (image.imageHeight as number) > 0
      ? image.imageHeight
      : undefined);
  const cropWidth =
    image.crop && Number.isFinite(image.crop.w) && image.crop.w > 0
      ? Math.max(
          image.crop.w,
          Number.isFinite(image.crop.x) ? image.crop.x + image.crop.w : image.crop.w,
        )
      : 1;
  const cropHeight =
    image.crop && Number.isFinite(image.crop.h) && image.crop.h > 0
      ? Math.max(
          image.crop.h,
          Number.isFinite(image.crop.y) ? image.crop.y + image.crop.h : image.crop.h,
        )
      : 1;
  const crop = normalizeImageCropRect(
    image.crop,
    imageWidth ?? cropWidth,
    imageHeight ?? cropHeight,
  );
  const rotation = normalizeImageRotation(image.rotation);
  const perspective = normalizeImagePerspective(image.perspective);

  const normalized: ImageFillData = {
    ...image,
    fit: isImageFit(image.fit) ? image.fit : 'fill',
    x: Number.isFinite(image.x) ? image.x : 0,
    y: Number.isFinite(image.y) ? image.y : 0,
    scale: Number.isFinite(image.scale) && image.scale > 0 ? image.scale : 1,
    ...(imageWidth !== undefined ? { imageWidth } : {}),
    ...(imageHeight !== undefined ? { imageHeight } : {}),
    ...(crop !== undefined ? { crop } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(image.flipH !== undefined ? { flipH: image.flipH === true } : {}),
    ...(image.flipV !== undefined ? { flipV: image.flipV === true } : {}),
    ...(perspective !== undefined ? { perspective } : {}),
  };

  if (imageWidth === undefined) delete normalized.imageWidth;
  if (imageHeight === undefined) delete normalized.imageHeight;
  if (crop === undefined) delete normalized.crop;
  if (rotation === undefined) delete normalized.rotation;
  if (perspective === undefined) delete normalized.perspective;
  return normalized;
}

// ── Layer States (saved view/layer states — Varve-native, no Photoshop comps) ──

export type LayerStateCategory = 'visibility' | 'transforms' | 'appearance';

export interface AppearanceSnapshot {
  opacity?: number;
  blendMode?: BlendMode;
  fill?: ManagedColor;
}

export interface LayerStateCapture {
  visibility?: Record<NodeId, boolean>;
  transforms?: Record<NodeId, Affine>;
  appearance?: Record<NodeId, AppearanceSnapshot>;
}

export interface LayerState {
  /** Stable id (never the node name). */
  id: string;
  name: string;
  categories: LayerStateCategory[];
  captured: LayerStateCapture;
  createdAt: string;
}

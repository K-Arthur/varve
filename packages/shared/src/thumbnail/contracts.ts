/**
 * Canonical thumbnail contracts — the single source of truth for thumbnail
 * semantics across every Varve surface.
 *
 * A thumbnail is fully described by:
 *
 *   subject (document/page/frame/selection/region)  →  `ThumbnailSourceSpec`
 *   profile (size, fit, background, format)         →  `ThumbnailVariant`
 *   identity (deterministic cache key)              →  `ThumbnailIdentity`
 *   lifecycle (UI states)                           →  `ThumbnailStatus`
 *   privacy (encryption, network)                   →  `ThumbnailPolicy`
 *
 * Layering rule: nothing in this module may depend on React, the DOM, the
 * engine, the scene model, or any platform storage. Callers (editor, home,
 * engine service) adapt these contracts to their own layers.
 */

/** What content a thumbnail represents. */
export type ThumbnailSourceSpec =
  | { type: 'automatic' }
  | { type: 'page'; pageId: string }
  | { type: 'frame'; nodeId: string }
  | { type: 'selection'; nodeIds: string[] }
  | { type: 'region'; region: ThumbnailRegion };

/** A user-defined rectangular crop of the design, in document coordinates. */
export interface ThumbnailRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Short, human-meaningful label for a source spec. */
export function thumbnailSourceLabel(spec: ThumbnailSourceSpec): string {
  switch (spec.type) {
    case 'automatic':
      return 'Automatic';
    case 'page':
      return 'Page';
    case 'frame':
      return 'Frame';
    case 'selection':
      return 'Selection';
    case 'region':
      return 'Design region';
  }
}

// ─── Variants (output profiles) ─────────────────────────────────────────────

/** The role a thumbnail plays; each role has a fixed output profile. */
export type ThumbnailRole =
  | 'home-card'
  | 'home-list'
  | 'page-nav'
  | 'page-panel'
  | 'version-history'
  | 'picker-preview'
  | 'export-preview';

export type ThumbnailFit = 'contain' | 'cover' | 'fill';

export type ThumbnailBackground =
  | { type: 'transparent' }
  | { type: 'solid'; color: string }
  | { type: 'checkerboard' }
  | { type: 'match-theme' };

export type ThumbnailFormat = 'png' | 'webp';

/** Output profile for one role. Immutable by convention. */
export interface ThumbnailVariant {
  readonly role: ThumbnailRole;
  readonly width: number;
  readonly height: number;
  readonly fit: ThumbnailFit;
  readonly background: ThumbnailBackground;
  readonly format: ThumbnailFormat;
  /** Pixel density; 2 renders a HiDPI image that is downscaled on display. */
  readonly devicePixelRatio: 1 | 2;
}

/** Registry of every variant the product requests. Add roles here, not ad hoc. */
export const THUMBNAIL_VARIANTS: Record<ThumbnailRole, ThumbnailVariant> = {
  'home-card': {
    role: 'home-card',
    width: 256,
    height: 192,
    fit: 'contain',
    background: { type: 'transparent' },
    format: 'png',
    devicePixelRatio: 1,
  },
  'home-list': {
    role: 'home-list',
    width: 128,
    height: 96,
    fit: 'contain',
    background: { type: 'transparent' },
    format: 'png',
    devicePixelRatio: 1,
  },
  'page-nav': {
    role: 'page-nav',
    width: 180,
    height: 90,
    fit: 'contain',
    background: { type: 'solid', color: '#ffffff' },
    format: 'png',
    devicePixelRatio: 1,
  },
  'page-panel': {
    role: 'page-panel',
    width: 180,
    height: 90,
    fit: 'contain',
    background: { type: 'solid', color: '#ffffff' },
    format: 'png',
    devicePixelRatio: 1,
  },
  'version-history': {
    role: 'version-history',
    width: 120,
    height: 90,
    fit: 'contain',
    background: { type: 'transparent' },
    format: 'png',
    devicePixelRatio: 1,
  },
  'picker-preview': {
    role: 'picker-preview',
    width: 256,
    height: 192,
    fit: 'contain',
    background: { type: 'checkerboard' },
    format: 'png',
    devicePixelRatio: 1,
  },
  'export-preview': {
    role: 'export-preview',
    width: 256,
    height: 192,
    fit: 'contain',
    background: { type: 'transparent' },
    format: 'png',
    devicePixelRatio: 1,
  },
};

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * UI lifecycle of a thumbnail slot. `provisional` means the stored image was
 * rendered before all fonts/images were ready and must not be treated as
 * authoritative forever.
 */
export type ThumbnailStatus =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'missing'
  | 'error'
  | 'empty'
  | 'encrypted'
  | 'stale'
  | 'unsupported'
  | 'provisional';

// ─── Policy ─────────────────────────────────────────────────────────────────

/**
 * Privacy + resource policy for one thumbnail.
 *
 * `networkAccess: 'denied'` is structural: thumbnail generation must never
 * load arbitrary remote resources, so the security contract is encoded in
 * the policy type itself.
 */
export interface ThumbnailPolicy {
  /** Encrypted projects never write plaintext preview pixels. */
  readonly encrypted: boolean;
  /** User-approved embedded preview inside the (encrypted) archive. */
  readonly allowEmbeddedPreview: boolean;
  /** Thumbnails never fetch remote network resources. */
  readonly networkAccess: 'denied';
  /** Background for transparent areas at display time (when no image). */
  readonly displayBackground: ThumbnailBackground;
}

export const DEFAULT_THUMBNAIL_POLICY: ThumbnailPolicy = {
  encrypted: false,
  allowEmbeddedPreview: false,
  networkAccess: 'denied',
  displayBackground: { type: 'transparent' },
};

// ─── Priority / scheduling ──────────────────────────────────────────────────

export type ThumbnailPriority = 'visible' | 'current-doc' | 'background' | 'idle';

// ─── Identity ───────────────────────────────────────────────────────────────

/**
 * Version of the identity scheme. Bump only when the composition changes in
 * a way that makes old keys semantically wrong (e.g. a component was added
 * or a part's encoding changed). Old cache entries are disposable.
 */
export const THUMBNAIL_IDENTITY_VERSION = 2;

/** Namespace for local-only thumbnails (reserved for future cloud/team). */
export const THUMBNAIL_NAMESPACE_LOCAL = 'local';

/**
 * Canonical, deterministic cache identity.
 *
 * Every part participates in the key so that no two thumbnails with
 * different semantics ever share a storage slot:
 *  - different documents        → different `docKey`
 *  - same doc, new revision     → different `revisionHash`
 *  - same revision, two sources → different `sourceKey`
 *  - same source, two sizes     → different `variantKey`
 *  - renderer schema change     → different `rendererVersion`
 *
 * `docKey` MUST be the stable file identity (FileEntry.id), NOT a bare node
 * or page id. Node/page ids are per-document sequential and collide across
 * documents (every new document's first node is `n1`).
 */
export interface ThumbnailIdentityParts {
  readonly identityVersion: number;
  readonly namespace: string;
  readonly docKey: string;
  readonly revisionHash: string;
  readonly sourceKey: string;
  readonly variantKey: string;
  readonly rendererVersion: string;
  /** Render profile (color/rendering policy). Currently always 'default'. */
  readonly profileKey: string;
}

export interface ThumbnailIdentity {
  /** The full deterministic storage key. Never construct manually. */
  readonly key: string;
  readonly parts: Readonly<ThumbnailIdentityParts>;
}

/** Deterministic serialization of a source spec (order-independent for selection). */
export function thumbnailSourceKey(spec: ThumbnailSourceSpec): string {
  switch (spec.type) {
    case 'automatic':
      return 'auto';
    case 'page':
      return `page:${spec.pageId}`;
    case 'frame':
      return `frame:${spec.nodeId}`;
    case 'selection': {
      const sorted = [...spec.nodeIds].sort();
      return `sel:${sorted.join(',')}`;
    }
    case 'region': {
      const r = spec.region;
      const round = (n: number): number => Math.round(n * 1000) / 1000;
      return `region:${round(r.x)},${round(r.y)},${round(r.w)},${round(r.h)}`;
    }
  }
}

/** Deterministic serialization of a variant. */
export function thumbnailVariantKey(variant: ThumbnailVariant): string {
  const bg =
    variant.background.type === 'solid'
      ? `solid:${variant.background.color}`
      : variant.background.type;
  return `${variant.role}:${variant.width}x${variant.height}:${variant.fit}:${bg}:${variant.format}:${variant.devicePixelRatio}x`;
}

export interface ThumbnailIdentityInput {
  docKey: string;
  revisionHash: string;
  source: ThumbnailSourceSpec;
  variant: ThumbnailVariant;
  rendererVersion: string;
  namespace?: string;
  profileKey?: string;
}

/**
 * Build the canonical identity for a thumbnail request.
 * Deterministic: identical inputs always produce identical keys, across runs,
 * platforms, and process restarts.
 */
export function computeThumbnailIdentity(input: ThumbnailIdentityInput): ThumbnailIdentity {
  const parts: ThumbnailIdentityParts = {
    identityVersion: THUMBNAIL_IDENTITY_VERSION,
    namespace: input.namespace ?? THUMBNAIL_NAMESPACE_LOCAL,
    docKey: input.docKey,
    revisionHash: input.revisionHash,
    sourceKey: thumbnailSourceKey(input.source),
    variantKey: thumbnailVariantKey(input.variant),
    rendererVersion: input.rendererVersion,
    profileKey: input.profileKey ?? 'default',
  };
  const key = [
    'thumb',
    `v${parts.identityVersion}`,
    parts.namespace,
    parts.docKey,
    parts.revisionHash,
    parts.sourceKey,
    parts.variantKey,
    parts.rendererVersion,
    parts.profileKey,
  ].join(':');
  return { key, parts };
}

/** True when a key was produced by this identity scheme (vs. legacy bare content hashes). */
export function isCanonicalThumbnailKey(key: string): boolean {
  return key.startsWith('thumb:v');
}

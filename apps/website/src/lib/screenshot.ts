/**
 * Screenshot manifest contract for website consumers.
 *
 * Every screenshot on the site is described by
 * `src/data/screenshot-manifest.json`, which the capture pipeline generates.
 * This module is the single place that turns a manifest entry into render
 * attributes, so the showcase, feature pages, docs figures and tests cannot
 * drift into four different opinions about cropping, sizing or alt text.
 *
 * The important rule lives in `sceneFitStyle`: a captured scene's *kind*
 * decides how it is displayed, and a scene is never scaled larger than the
 * pixels it actually has. Showcase detail cards may request a shared frame;
 * those images use `contain`, while ordinary placements retain their own
 * captured aspect ratio.
 */
import manifest from '../data/screenshot-manifest.json';

export type SceneTheme = 'light' | 'dark';
export type SceneKind = 'full' | 'detail' | 'panel' | 'wide';

export interface SceneVariant {
  file: string;
  width: number;
  height: number;
  sha256?: string;
}

export type VariantImageType = 'image/avif' | 'image/webp';

export interface PictureSource {
  type: VariantImageType;
  srcset: string;
  sizes?: string;
}

export interface ScreenshotScene {
  file: string;
  alt: string;
  caption: string;
  feature?: string;
  theme: SceneTheme;
  kind?: SceneKind;
  status?: 'captured' | 'skipped';
  reason?: string;
  width?: number;
  height?: number;
  sha256?: string;
  variants?: SceneVariant[];
}

const scenes = (manifest as { scenes: Record<string, ScreenshotScene> }).scenes;

/** A captured scene, or `null` when the entry is missing or was not captured. */
export function getScene(id: string): ScreenshotScene | null {
  const scene = scenes[id];
  return scene && scene.status === 'captured' ? scene : null;
}

/** Every captured scene, in manifest order. */
export function allScenes(): [string, ScreenshotScene][] {
  return Object.entries(scenes).filter(
    (entry): entry is [string, ScreenshotScene] => entry[1]?.status === 'captured',
  );
}

export function sceneKind(scene: ScreenshotScene): SceneKind {
  if (scene.kind) return scene.kind;
  return 'full';
}

/**
 * Inline sizing for a captured scene.
 *
 * `full`, `detail` and `wide` scenes fill their column at their own aspect
 * ratio. `panel` scenes are tall columns; they are capped at their intrinsic
 * pixel width so a 288-pixel crop is never stretched across a phone screen,
 * which is what "readable at the size the site shows it" actually requires.
 */
export function sceneFitStyle(scene: ScreenshotScene, fit: 'scene' | 'contain' = 'scene'): string {
  if (fit === 'contain') {
    const maxWidth =
      sceneKind(scene) === 'panel' && scene.width ? `min(100%, ${scene.width}px)` : '100%';
    // Percentage max-heights do not constrain a replaced image when its
    // parent's height comes from aspect-ratio. Put the image over a definite
    // card frame and let object-fit contain the complete capture inside it.
    return `position: absolute; inset: 0; width: 100%; height: 100%; max-width: ${maxWidth}; object-fit: contain;`;
  }
  if (sceneKind(scene) === 'panel' && scene.width) {
    return `max-width: ${scene.width}px; width: 100%;`;
  }
  return 'width: 100%;';
}

export interface PictureAttributes {
  src: string;
  sources: PictureSource[];
  srcset?: string;
  sizes?: string;
  type?: string;
  width: number;
  height: number;
  alt: string;
  loading: 'lazy' | 'eager';
  decoding: 'async' | 'sync';
  fetchpriority: 'high' | 'auto' | 'low';
}

const SOURCE_TYPE_ORDER: VariantImageType[] = ['image/avif', 'image/webp'];

/** MIME type for a generated screenshot derivative, or `null` for the PNG source. */
export function variantImageType(file: string): VariantImageType | null {
  if (file.endsWith('.avif')) return 'image/avif';
  if (file.endsWith('.webp')) return 'image/webp';
  return null;
}

/**
 * Prefix every `srcset` URL with the site base path.
 *
 * Variant `srcset` values are root-relative (`/screenshots/...`). The Pages
 * project-site build serves under `/varve`, so those URLs must go through
 * `sitePath` the same way the `<img src>` does.
 */
export function qualifySrcset(srcset: string, qualify: (url: string) => string): string {
  return srcset
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      const descriptor = trimmed.match(/\s+(\d+w|\d+(?:\.\d+)?x)$/);
      if (!descriptor || descriptor.index === undefined) return qualify(trimmed);
      const url = trimmed.slice(0, descriptor.index);
      return `${qualify(url)} ${descriptor[1]}`;
    })
    .join(', ');
}

function srcsetFor(variants: SceneVariant[]): string {
  return variants
    .slice()
    .sort((left, right) => left.width - right.width)
    .map((variant) => `/screenshots/${variant.file} ${variant.width}w`)
    .join(', ');
}

/**
 * `srcset`/`sizes` from the *measured* component layout.
 *
 * Width descriptors come from the real variant files, grouped by format so
 * `<picture>` can offer AVIF then WebP. The PNG capture stays the `<img>`
 * fallback and is never mixed into a compressed `srcset`. A scene with no
 * generated variants returns no sources, so the browser downloads exactly
 * one file rather than guessing from a placeholder.
 */
export function scenePicture(
  scene: ScreenshotScene,
  {
    sizes = '100vw',
    loading = 'lazy',
    fetchpriority = 'auto',
  }: { sizes?: string; loading?: 'lazy' | 'eager'; fetchpriority?: 'high' | 'auto' | 'low' } = {},
): PictureAttributes {
  const width = scene.width ?? 1440;
  const height = scene.height ?? 900;
  const variants = (scene.variants ?? []).filter((variant) => variant.width <= width);
  const byType = new Map<VariantImageType, SceneVariant[]>();
  for (const variant of variants) {
    const type = variantImageType(variant.file);
    if (!type) continue;
    const list = byType.get(type) ?? [];
    list.push(variant);
    byType.set(type, list);
  }
  const sources: PictureSource[] = [];
  for (const type of SOURCE_TYPE_ORDER) {
    const list = byType.get(type);
    if (!list?.length) continue;
    sources.push({ type, srcset: srcsetFor(list), sizes });
  }
  const webp = sources.find((source) => source.type === 'image/webp');
  return {
    src: `/screenshots/${scene.file}`,
    sources,
    srcset: webp?.srcset,
    sizes: sources.length > 0 ? sizes : undefined,
    width,
    height,
    alt: scene.alt,
    loading,
    decoding: 'async',
    fetchpriority,
  };
}

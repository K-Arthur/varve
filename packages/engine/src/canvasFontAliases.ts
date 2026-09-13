/**
 * Canvas2D's font shorthand has no portable slot for OpenType feature values
 * or custom variation axes.  When the browser does not expose the optional
 * context properties, a local @font-face alias is the one standards-based
 * way to keep a whole-run setting attached to the real font artifact.
 *
 * The alias is deliberately process-local.  The scene stores the authored
 * feature map and axis coordinates; it never stores this generated family
 * name.  Source-range settings are not represented here because an
 * @font-face descriptor applies to the whole face and splitting a shaped run
 * would corrupt joining context.
 */

import {
  isOpenTypeFeatureTag,
  type OpenTypeFeatureMap,
  openTypeFeaturesToCss,
} from '@varve/shared';

interface CanvasFontAliasFace {
  family: string;
  source: string;
  weight?: string;
  style?: string;
  stretch?: string;
  unicodeRange?: string;
  display?: string;
}

interface CanvasFontAliasEntry {
  family: string;
  css: string;
  ready: boolean;
  active: boolean;
  fontFaces: FontFace[];
  aliasFaces: CanvasFontAliasFace[];
  featureSettings?: string;
  variationSettings?: string;
}

const MAX_ALIASES = 64;
const MAX_ALIAS_STYLES = 4;
const ALIAS_STYLE_ID = 'varve-canvas-font-aliases';
const CANVAS_ALIAS_PREFIX = 'VarveManualProbe_';
const LEGACY_CANVAS_ALIAS_PREFIX = '__varve_';
const ALIAS_SESSION_ID = `s${hashString(`${Date.now()}:${Math.random()}`)}`;
const aliases = new Map<string, CanvasFontAliasEntry>();
const sourceFacesByFamily = new Map<string, CanvasFontAliasFace[]>();
const readyListeners = new Set<() => void>();
let sourceFacesStyleSheetCount = -1;
let aliasStyle: HTMLStyleElement | null = null;
const aliasStyles: HTMLStyleElement[] = [];

/**
 * Resolve a whole-run Canvas2D font alias for feature/axis settings.
 *
 * Returns the authored family when the runtime is not a DOM, the setting has
 * source ranges, or no inspectable local @font-face source exists (for
 * example a system-only `local()` face).  Those cases remain honest
 * capability fallbacks and are handled by the exact shaping/export paths.
 */
export function resolveCanvasFontFamily(
  family: string,
  features?: OpenTypeFeatureMap,
  axes?: Record<string, number>,
  text?: string,
): string {
  const featureSettings = openTypeFeaturesToCss(features);
  const variationSettings = canvasVariationSettings(axes);
  if (!featureSettings && !variationSettings) return family;
  if (typeof document === 'undefined') return family;

  const faces = findFontFaces(family);
  if (faces.length === 0) return family;

  // Keep only the source faces that can cover this run. A variable family
  // split into unicode-range subsets can otherwise make Canvas2D retain the
  // first (non-Latin, for example) face while the feature-bearing Latin face
  // is present and loaded. A later run in another script gets its own cache
  // identity and alias family.
  const aliasFaces = facesForText(faces, text);
  const faceKey = aliasFaces.map(serializeFace).join('|');
  const key = `${family}\u0000${faceKey}\u0000${featureSettings ?? ''}\u0000${variationSettings ?? ''}`;
  const cached = aliases.get(key);
  if (cached) {
    // Do not let a Canvas2D context see the alias until its source and
    // generated faces have loaded. Chromium can cache the fallback chosen for
    // that shorthand on the context; the repaint after load must be the first
    // time this alias is assigned to the artwork context.
    return isAliasReady(cached) ? cached.family : family;
  }

  // Keep a letter immediately before the hash. Some Canvas font shorthands
  // accept a family ending in `_1…` but fail to resolve it consistently even
  // when the matching FontFace objects are loaded.
  const aliasFamily = `${CANVAS_ALIAS_PREFIX}live${hashString(key)}_${ALIAS_SESSION_ID}`;
  const entry: CanvasFontAliasEntry = {
    family: aliasFamily,
    css: buildAliasCss(aliasFamily, aliasFaces, featureSettings, variationSettings),
    ready: false,
    active: true,
    fontFaces: [],
    aliasFaces: [...aliasFaces],
    ...(featureSettings ? { featureSettings } : {}),
    ...(variationSettings ? { variationSettings } : {}),
  };
  aliases.set(key, entry);
  while (aliases.size > MAX_ALIASES) {
    const oldest = aliases.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const evicted = aliases.get(oldest);
    if (evicted) {
      evicted.active = false;
      removeFontFaces(evicted);
    }
    aliases.delete(oldest);
  }
  // Registration is deliberately deferred until the authored source face has
  // been requested. Creating a feature face while the source is still cold
  // can leave Chromium's per-context font cache attached to the unmodified
  // source, even after the generated FontFace reports loaded.
  if (hasFontSetApi()) {
    scheduleAliasRegistration(entry, family, text);
    return family;
  }

  // Older webviews may not expose FontFace. Keep the CSS fallback immediate;
  // its lazy loading semantics are the only option available in that runtime.
  refreshAliasStyle();
  entry.ready = true;
  return aliasFamily;
}

/** True when this DOM can construct a whole-run alias for the request. */
export function canResolveCanvasFontFamily(
  family: string,
  features?: OpenTypeFeatureMap,
  axes?: Record<string, number>,
): boolean {
  const featureSettings = openTypeFeaturesToCss(features);
  const variationSettings = canvasVariationSettings(axes);
  const hasFeatures = Object.keys(features ?? {}).length > 0;
  if (hasFeatures && !featureSettings) return false;
  if (!featureSettings && !variationSettings) return true;
  if (typeof document === 'undefined') return false;
  return findFontFaces(family).length > 0;
}

/** Clear process-local aliases; useful after a test replaces the stylesheet. */
export function resetCanvasFontAliases(): void {
  for (const entry of aliases.values()) {
    entry.active = false;
    removeFontFaces(entry);
  }
  aliases.clear();
  sourceFacesByFamily.clear();
  sourceFacesStyleSheetCount = -1;
  for (const style of aliasStyles) style.remove();
  aliasStyles.length = 0;
  aliasStyle = null;
}

/** Subscribe to completion of a generated face so the editor can repaint. */
export function subscribeToCanvasFontReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

/**
 * Assign a Canvas font while invalidating Chromium's cached fallback choice
 * for a generated alias. The neutral assignment is only needed for aliases;
 * ordinary text keeps the single setter used by the hot path.
 */
export function setCanvasFont(context: Pick<CanvasRenderingContext2D, 'font'>, font: string): void {
  if (isCanvasFontAliasString(font)) context.font = '1px sans-serif';
  context.font = font;
}

function hasFontSetApi(): boolean {
  return typeof document.fonts?.load === 'function';
}

function canvasVariationSettings(axes?: Record<string, number>): string | undefined {
  const values = Object.entries(axes ?? {})
    .filter(([tag, value]) => tag !== 'wght' && isOpenTypeFeatureTag(tag) && Number.isFinite(value))
    .sort(([a], [b]) => a.localeCompare(b));
  if (values.length === 0) return undefined;
  return values.map(([tag, value]) => `${quoteCss(tag)} ${value}`).join(',');
}

function findFontFaces(family: string): CanvasFontAliasFace[] {
  const wanted = normalizeFamily(family);
  if (!wanted) return [];
  const styleSheetCount = document.styleSheets.length;
  if (styleSheetCount !== sourceFacesStyleSheetCount) {
    sourceFacesByFamily.clear();
    sourceFacesStyleSheetCount = styleSheetCount;
  }
  const cached = sourceFacesByFamily.get(wanted);
  if (cached) return cached;
  const faces: CanvasFontAliasFace[] = [];
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSFontFaceRule).style;
      if (!style || typeof style.getPropertyValue !== 'function') continue;
      const source = style.getPropertyValue('src').trim();
      const declaredFamily = normalizeFamily(style.getPropertyValue('font-family'));
      if (!source || declaredFamily !== wanted) continue;
      const face: CanvasFontAliasFace = {
        family: declaredFamily,
        source,
        weight: descriptorValue(style, 'font-weight'),
        style: descriptorValue(style, 'font-style'),
        stretch: descriptorValue(style, 'font-stretch'),
        unicodeRange: descriptorValue(style, 'unicode-range'),
        display: descriptorValue(style, 'font-display'),
      };
      const key = serializeFace(face);
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push(face);
    }
  }
  sourceFacesByFamily.set(wanted, faces);
  return faces;
}

function facesForText(
  faces: readonly CanvasFontAliasFace[],
  text: string | undefined,
): CanvasFontAliasFace[] {
  if (text === undefined || text.length === 0) return [...faces];
  const codePoints = Array.from(text, (character) => character.codePointAt(0) ?? 0);
  const selected = faces.filter(
    (face) =>
      !face.unicodeRange ||
      codePoints.some((codePoint) => unicodeRangeContains(face.unicodeRange!, codePoint)),
  );
  return selected.length > 0 ? selected : [...faces];
}

function unicodeRangeContains(range: string, codePoint: number): boolean {
  return range.split(',').some((part) => {
    const value = part.trim().replace(/^U\+/i, '');
    if (!value) return false;
    if (value.includes('?')) {
      const min = Number.parseInt(value.replaceAll('?', '0'), 16);
      const max = Number.parseInt(value.replaceAll('?', 'F'), 16);
      return Number.isFinite(min) && Number.isFinite(max) && codePoint >= min && codePoint <= max;
    }
    const [startText, endText] = value.split('-');
    const start = Number.parseInt(startText ?? '', 16);
    const end = Number.parseInt(endText ?? startText ?? '', 16);
    return Number.isFinite(start) && Number.isFinite(end) && codePoint >= start && codePoint <= end;
  });
}

function scheduleAliasRegistration(
  entry: CanvasFontAliasEntry,
  sourceFamily: string,
  text: string | undefined,
): void {
  const register = (): void => {
    if (!entry.active) return;
    // Publish a new stylesheet family only after the authored family has
    // warmed. Registering the same family first through FontFace objects can
    // make Chromium retain the variable face's default GSUB state even when
    // the FontFace reports the requested feature descriptor as loaded.
    refreshAliasStyle();
    const stagedReady = text
      ? document.fonts?.load(`16px ${quoteCss(entry.family)}`, text)
      : document.fonts?.load(`16px ${quoteCss(entry.family)}`);
    if (!stagedReady) {
      publishPaintAlias(entry, text);
      return;
    }
    void stagedReady.then(
      () => publishPaintAlias(entry, text),
      () => publishPaintAlias(entry, text),
    );
  };

  try {
    // Warm the authored face first. This is intentionally separate from the
    // generated face load because some Chromium versions bind the first
    // source-font lookup to a Canvas context's family cache.
    const sourceReady = text
      ? document.fonts?.load(`16px ${quoteCss(sourceFamily)}`, text)
      : undefined;
    if (sourceReady) {
      void sourceReady.then(register, register);
    } else {
      register();
    }
  } catch {
    register();
  }
}

/**
 * Publish the family that Canvas2D will actually paint.
 *
 * Chromium can bind a dynamically-created family to the default GSUB state
 * during its first FontFaceSet lookup. The staged family above is intentionally
 * never handed to a drawing context. A second, fresh family is published after
 * the source and staging lookup have settled; this mirrors the browser's own
 * stylesheet insertion path and prevents a feature-bearing alias from being
 * poisoned by its readiness probe.
 */
function publishPaintAlias(entry: CanvasFontAliasEntry, text: string | undefined): void {
  if (!entry.active) return;
  const paintFamily = `${CANVAS_ALIAS_PREFIX}paint${hashString(`${entry.family}:paint`)}_${ALIAS_SESSION_ID}`;
  entry.family = paintFamily;
  entry.css = buildAliasCss(
    paintFamily,
    entry.aliasFaces,
    entry.featureSettings,
    entry.variationSettings,
  );
  refreshAliasStyle();
  const paintReady = text
    ? document.fonts?.load(`16px ${quoteCss(paintFamily)}`, text)
    : document.fonts?.load(`16px ${quoteCss(paintFamily)}`);
  if (paintReady) {
    void paintReady
      .then(
        () => waitForCanvasFontStability(),
        () => waitForCanvasFontStability(),
      )
      .then(
        () => publishActivationAlias(entry, text),
        () => notifyCanvasFontReady(),
      );
  } else {
    markAliasReady(entry);
  }
}

/** Publish one final fresh family after the readiness probes have settled. */
function publishActivationAlias(entry: CanvasFontAliasEntry, text: string | undefined): void {
  if (!entry.active) return;
  const activationFamily = `${CANVAS_ALIAS_PREFIX}active${hashString(`${entry.family}:active`)}_${ALIAS_SESSION_ID}`;
  entry.family = activationFamily;
  entry.css = buildAliasCss(
    activationFamily,
    entry.aliasFaces,
    entry.featureSettings,
    entry.variationSettings,
  );
  refreshAliasStyle();
  const activationReady = text
    ? document.fonts?.load(`16px ${quoteCss(activationFamily)}`, text)
    : document.fonts?.load(`16px ${quoteCss(activationFamily)}`);
  if (activationReady) {
    void activationReady
      .then(
        () => waitForCanvasFontStability(),
        () => waitForCanvasFontStability(),
      )
      .then(
        () => markAliasReady(entry),
        () => notifyCanvasFontReady(),
      );
  } else {
    markAliasReady(entry);
  }
}

/** Let the browser commit a newly loaded face before any Canvas context sees it. */
async function waitForCanvasFontStability(): Promise<void> {
  await document.fonts?.ready;
  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function isAliasReady(entry: CanvasFontAliasEntry): boolean {
  return entry.ready;
}

function markAliasReady(entry: CanvasFontAliasEntry): void {
  if (!entry.active) return;
  entry.ready = true;
  notifyCanvasFontReady();
}

function removeFontFaces(entry: CanvasFontAliasEntry): void {
  if (typeof document === 'undefined') {
    entry.fontFaces = [];
    return;
  }
  for (const face of entry.fontFaces) {
    try {
      document.fonts?.delete(face);
    } catch {
      // A legacy FontFaceSet may not expose delete; inactive aliases are
      // still unreachable and the bounded map prevents further growth.
    }
  }
  entry.fontFaces = [];
}

function isCanvasFontAliasString(font: string): boolean {
  return (
    font.includes(CANVAS_ALIAS_PREFIX) ||
    font.includes('VarveCanvasAlias_') ||
    font.includes(LEGACY_CANVAS_ALIAS_PREFIX)
  );
}

function buildAliasCss(
  aliasFamily: string,
  faces: readonly CanvasFontAliasFace[],
  featureSettings: string | undefined,
  variationSettings: string | undefined,
): string {
  return faces
    .map((face) => {
      const descriptors = [
        `font-family:${quoteCss(aliasFamily)}`,
        `src:${face.source}`,
        face.weight ? `font-weight:${face.weight}` : '',
        face.style ? `font-style:${face.style}` : '',
        face.stretch ? `font-stretch:${face.stretch}` : '',
        face.unicodeRange ? `unicode-range:${face.unicodeRange}` : '',
        featureSettings ? `font-feature-settings:${featureSettings}` : '',
        variationSettings ? `font-variation-settings:${variationSettings}` : '',
      ].filter(Boolean);
      return `@font-face{${descriptors.join(';')}}`;
    })
    .join('');
}

function descriptorValue(style: CSSStyleDeclaration, property: string): string | undefined {
  const value = style.getPropertyValue(property).trim();
  return value || undefined;
}

function serializeFace(face: CanvasFontAliasFace): string {
  return [
    face.family,
    face.source,
    face.weight,
    face.style,
    face.stretch,
    face.unicodeRange,
    face.display,
  ].join('|');
}

function normalizeFamily(value: string): string {
  return value
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .replace(/\\([\\'"])/g, '$1')
    .toLocaleLowerCase();
}

function quoteCss(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function refreshAliasStyle(): void {
  // Keep a short history of parsed stylesheets. Chromium can retain a
  // feature-disabled face choice when the stylesheet that introduced it is
  // removed while a FontFaceSet load is settling. Retaining the last few
  // immutable parses keeps the browser's face records alive without allowing
  // generated CSS to grow without bound.
  const nextStyle = document.createElement('style');
  aliasStyle?.removeAttribute('id');
  nextStyle.id = ALIAS_STYLE_ID;
  nextStyle.dataset.varveGenerated = 'canvas-font-alias';
  nextStyle.textContent = [...aliases.values()].map((entry) => entry.css).join('');
  document.head?.append(nextStyle);
  aliasStyles.push(nextStyle);
  while (aliasStyles.length > MAX_ALIAS_STYLES) aliasStyles.shift()?.remove();
  aliasStyle = nextStyle;
  void aliasStyle.sheet?.cssRules.length;
}

function notifyCanvasFontReady(): void {
  for (const listener of readyListeners) listener();
}

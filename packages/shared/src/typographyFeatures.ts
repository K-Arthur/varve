/**
 * Portable OpenType feature settings shared by scene, engine, and editor.
 *
 * The authored boundary uses UTF-16 offsets because that is the unit used by
 * DOM selections, textarea APIs, and the persisted scene. Shaping backends
 * convert these ranges to their own buffer units before calling HarfBuzz or
 * Rustybuzz.
 *
 * An absent map entry means inherit/unset. A Boolean or number is the compact
 * whole-run form (`false` is an explicit off value, `true` is on, and numbers
 * are font-defined indexed values). The object form adds source ranges without
 * changing the logical text.
 */

export type OpenTypeFeatureValue = boolean | number;

export interface OpenTypeFeatureRange {
  /** Inclusive UTF-16 source offset. */
  startUtf16: number;
  /** Exclusive UTF-16 source offset. */
  endUtf16: number;
  /** Boolean or font-defined numeric/indexed value. */
  value: OpenTypeFeatureValue;
}

export interface OpenTypeFeatureSetting {
  /** Whole-run value when `ranges` is absent. */
  value: OpenTypeFeatureValue;
  /** Optional source-local overrides, applied in array order. */
  ranges?: readonly OpenTypeFeatureRange[];
}

/**
 * Legacy custom maps are nested under `custom`. The recursive record member
 * exists only for that legacy shape; consumers must validate tags and values
 * before sending them to a shaping backend.
 */
export type OpenTypeFeatureEntry =
  | OpenTypeFeatureValue
  | OpenTypeFeatureSetting
  | Record<string, OpenTypeFeatureValue | OpenTypeFeatureSetting | undefined>;

export type OpenTypeFeatureMap = Partial<Record<string, OpenTypeFeatureEntry>> & {
  custom?: Record<string, OpenTypeFeatureEntry | undefined>;
};

export interface NormalizedOpenTypeFeature {
  /** Four-byte OpenType tag. */
  tag: string;
  /** HarfBuzz feature value; 0 disables, positive values select/on. */
  value: number;
  /** Inclusive UTF-16 source offset. */
  startUtf16: number;
  /** Exclusive UTF-16 source offset. */
  endUtf16: number;
}

export interface FeatureNormalizationResult {
  features: NormalizedOpenTypeFeature[];
  warnings: string[];
}

/** Features that are optional ligature choices in the user-facing UI. */
export const OPTIONAL_LIGATURE_FEATURE_TAGS = ['dlig', 'hlig'] as const;

/**
 * Features that participate in script correctness or glyph composition.
 * `liga`/`calt` are enabled by default in CSS, but are intentionally absent
 * here: a user may explicitly turn those optional defaults off for a Latin
 * wordmark. A generic “optional ligatures off” action must never touch this
 * set or any script-required feature.
 */
export const REQUIRED_SHAPING_FEATURE_TAGS = new Set([
  'rlig',
  'ccmp',
  'locl',
  'mark',
  'mkmk',
  'curs',
  'init',
  'medi',
  'fina',
  'isol',
  'abvm',
  'blwm',
  'rvrn',
]);

/**
 * Common Latin sequences that are frequently substituted by `liga`.
 *
 * This is deliberately a conservative, font-independent safety check. The
 * feature registry tells us what a font may do, but only shaping that font
 * can tell us whether a particular sequence actually substitutes. A caller
 * that wants to move grapheme clusters independently must therefore avoid
 * splitting these sequences while standard ligatures might be enabled.
 */
const COMMON_STANDARD_LIGATURE_SEQUENCES = ['ffi', 'ffl', 'fi', 'fl', 'ff'] as const;

/**
 * Return whether a feature entry could enable a feature over a source range.
 * Invalid/nested legacy entries are treated as enabled so a malformed
 * setting cannot make a per-cluster renderer split shaping context silently.
 */
function featureCouldBeEnabled(
  entry: OpenTypeFeatureEntry | undefined,
  startUtf16: number,
  endUtf16: number,
): boolean {
  if (entry === undefined) return true;
  if (typeof entry === 'boolean') return entry;
  if (typeof entry === 'number') return Number.isFinite(entry) && entry > 0;
  if (!isOpenTypeFeatureSetting(entry)) return true;

  if (featureValueIsEnabled(entry.value)) return true;
  return (entry.ranges ?? []).some(
    (range) =>
      featureValueIsEnabled(range.value) &&
      Number.isFinite(range.startUtf16) &&
      Number.isFinite(range.endUtf16) &&
      range.endUtf16 > startUtf16 &&
      range.startUtf16 < endUtf16,
  );
}

function featureValueIsEnabled(value: OpenTypeFeatureValue): boolean {
  return typeof value === 'boolean' ? value : Number.isFinite(value) && value > 0;
}

/**
 * True when a common Latin ligature sequence could be shaped as one glyph.
 *
 * `liga` is enabled by default in OpenType/CSS. An explicit off value disables
 * the guard, while a ranged on value re-enables it only for overlapping text.
 * This helper is used by artistic-text paths before they split a source run;
 * it is not a claim that the selected font contains every listed ligature.
 */
export function hasPotentialStandardLigatureSequence(
  text: string,
  map: OpenTypeFeatureMap | undefined,
): boolean {
  if (text.length === 0) return false;
  const entries: Array<OpenTypeFeatureEntry | undefined> = [];
  const direct = map?.liga;
  const custom = map?.custom?.liga;
  if (direct !== undefined) entries.push(direct);
  if (custom !== undefined) entries.push(custom);
  if (entries.length === 0) entries.push(undefined);

  for (const sequence of COMMON_STANDARD_LIGATURE_SEQUENCES) {
    let from = text.indexOf(sequence);
    while (from >= 0) {
      const to = from + sequence.length;
      if (entries.some((entry) => featureCouldBeEnabled(entry, from, to))) return true;
      from = text.indexOf(sequence, from + 1);
    }
  }
  return false;
}

/** True when the tag is a valid four-byte printable OpenType tag. */
export function isOpenTypeFeatureTag(tag: string): boolean {
  return tag.length === 4 && /^[\x20-\x7e]{4}$/.test(tag);
}

/** Convert the authored Boolean/numeric value to HarfBuzz's integer value. */
export function normalizeOpenTypeFeatureValue(value: OpenTypeFeatureValue): number | undefined {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (!Number.isFinite(value)) return undefined;
  return Math.min(0xffffffff, Math.max(0, Math.trunc(value)));
}

/** Resolve a feature map from lowest to highest precedence. */
export function resolveOpenTypeFeatureMaps(
  ...layers: readonly (OpenTypeFeatureMap | undefined)[]
): OpenTypeFeatureMap {
  const result: OpenTypeFeatureMap = {};
  const custom: Record<string, OpenTypeFeatureEntry | undefined> = {};
  let hasCustom = false;

  for (const layer of layers) {
    if (!layer) continue;
    const entries = Object.entries(layer) as Array<[string, OpenTypeFeatureEntry | undefined]>;
    for (const [tag, value] of entries) {
      if (tag === 'custom') continue;
      result[tag] = value;
    }
    if (layer.custom) {
      hasCustom = true;
      for (const [tag, value] of Object.entries(layer.custom)) custom[tag] = value;
    }
  }

  if (hasCustom) result.custom = custom;
  return result;
}

/**
 * Normalize all valid feature entries into backend-neutral UTF-16 ranges.
 * Invalid tags, values, and ranges are dropped with a user-visible warning;
 * they never silently become a different feature.
 */
export function normalizeOpenTypeFeatureMap(
  map: OpenTypeFeatureMap | undefined,
  textLength: number,
): FeatureNormalizationResult {
  if (!map) return { features: [], warnings: [] };

  const boundedLength = Number.isFinite(textLength) ? Math.max(0, Math.trunc(textLength)) : 0;
  const features: NormalizedOpenTypeFeature[] = [];
  const warnings: string[] = [];

  const append = (tag: string, entry: OpenTypeFeatureEntry | undefined): void => {
    if (tag === 'custom') return;
    if (!isOpenTypeFeatureTag(tag)) {
      warnings.push(`Ignored invalid OpenType feature tag "${tag}".`);
      return;
    }
    if (entry === undefined || isNestedFeatureRecord(entry)) {
      warnings.push(`Ignored invalid value for OpenType feature "${tag}".`);
      return;
    }

    const setting = isOpenTypeFeatureSetting(entry) ? entry : { value: entry };
    const wholeRunValue = normalizeOpenTypeFeatureValue(setting.value);
    if (wholeRunValue === undefined) {
      warnings.push(`Ignored non-finite value for OpenType feature "${tag}".`);
      return;
    }

    // Keep the base value before range overrides. HarfBuzz resolves
    // overlapping feature records in order, so this makes the authored
    // setting mean “value everywhere, with these source-local exceptions”.
    features.push({
      tag,
      value: wholeRunValue,
      startUtf16: 0,
      endUtf16: boundedLength,
    });
    if (!setting.ranges || setting.ranges.length === 0) return;

    for (const range of setting.ranges) {
      const start = clampOffset(range.startUtf16, boundedLength);
      const end = clampOffset(range.endUtf16, boundedLength);
      const value = normalizeOpenTypeFeatureValue(range.value);
      if (value === undefined || end <= start) {
        warnings.push(`Ignored invalid range for OpenType feature "${tag}".`);
        continue;
      }
      features.push({ tag, value, startUtf16: start, endUtf16: end });
    }
  };

  const entries = Object.entries(map) as Array<[string, OpenTypeFeatureEntry | undefined]>;
  for (const [tag, entry] of entries) append(tag, entry);
  for (const [tag, entry] of Object.entries(map.custom ?? {}))
    append(tag, entry as OpenTypeFeatureEntry | undefined);
  return { features, warnings };
}

/** Build a CSS `font-feature-settings` value for source-run fallbacks. */
export function openTypeFeaturesToCss(map: OpenTypeFeatureMap | undefined): string | undefined {
  if (map && hasSourceRanges(map)) return undefined;
  const normalized = normalizeOpenTypeFeatureMap(map, Number.MAX_SAFE_INTEGER).features;
  if (normalized.length === 0) return undefined;
  const global = normalized.filter(
    (feature) => feature.startUtf16 === 0 && feature.endUtf16 === Number.MAX_SAFE_INTEGER,
  );
  if (global.length === 0) return undefined;
  return global.map((feature) => `"${feature.tag}" ${feature.value}`).join(', ');
}

function hasSourceRanges(map: OpenTypeFeatureMap): boolean {
  const entries = [...Object.entries(map), ...Object.entries(map.custom ?? {})] as Array<
    [string, OpenTypeFeatureEntry | undefined]
  >;
  return entries.some(
    ([, entry]) => isOpenTypeFeatureSetting(entry) && Boolean(entry.ranges?.length),
  );
}

function isOpenTypeFeatureSetting(
  value: OpenTypeFeatureEntry | undefined,
): value is OpenTypeFeatureSetting {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'value' in value &&
    (typeof value.value === 'boolean' || typeof value.value === 'number')
  );
}

function isNestedFeatureRecord(
  value: OpenTypeFeatureEntry,
): value is Record<string, OpenTypeFeatureValue | OpenTypeFeatureSetting | undefined> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('value' in value)
  );
}

function clampOffset(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(length, Math.max(0, Math.trunc(value)));
}

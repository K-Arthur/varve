/**
 * Canonical gradient preset model for gradient-map effects.
 *
 * A gradient map remaps the tonal value of rendered content through a color
 * ramp. The preset below is the single shared representation used by the
 * document model, the preset library, the `.grd`/JSON importers, the editor
 * UI, and (through a structural mirror) the engine renderer.
 *
 * It is deliberately distinct from `GradientFill` (a spatial fill based on
 * object coordinates). The two share stop/interpolation concepts but remain
 * separate scene concepts: a gradient fill paints a shape, a gradient preset
 * drives a tonal remap.
 *
 * Stability guarantees:
 *  - Stable stop and preset ids (persisted; only assigned when missing).
 *  - Deterministic serialization (same input -> same JSON output).
 *  - Colors are `ManagedColor`, never ambiguous CSS strings.
 *  - Unknown future fields are preserved on serialization (forward-compat).
 */

import type { ManagedColor } from './colorManagement';
import type { GradientInterpolationSpace } from './types';

/** How a preset's color stops are interpolated. Reuses fill gradient spaces. */
export type GradientInterpolation = GradientInterpolationSpace;

/**
 * Luminance/tonal source used to derive the 0-1 input position that samples
 * the color ramp.
 *
 * Only modes with a real user-facing purpose are exposed in the UI:
 * `relative-luminance` (default, Rec.709 / WCAG), `perceptual-lightness`
 * (Oklab L), `average-rgb`, `max-channel`. The remaining modes exist for
 * compatibility with imported assets and technical workflows.
 */
export type GradientLuminanceMode =
  | 'relative-luminance'
  | 'perceptual-lightness'
  | 'average-rgb'
  | 'max-channel'
  | 'alpha'
  | 'red'
  | 'green'
  | 'blue'
  | 'compatibility';

/** Solid ramps are fully editable; noise/unsupported are read-only or approximated. */
export type GradientPresetKind = 'solid' | 'noise' | 'unsupported';

/** Provenance of an imported or authored preset. */
export interface GradientPresetSource {
  /** Format the preset came from. */
  origin:
    | 'photoshop-grd'
    | 'photoshop-grd-legacy'
    | 'strata-gradient-json'
    | 'builtin'
    | 'manual'
    | 'unknown';
  /** Original file name when imported from a file. */
  fileName?: string;
  /** Original name inside the source file (may differ from `name`). */
  originalName?: string;
  /** Import timestamp (ISO) when imported from an external file. */
  importedAt?: string;
  /** Free-form diagnostics preserved from the importer. */
  extra?: Record<string, unknown>;
}

/** Compatibility state after import or on read. */
export interface GradientCompatibilityInfo {
  status: 'ok' | 'approximated' | 'unsupported';
  /** Short human-readable reason, e.g. "noise gradient, rendered as read-only". */
  message?: string;
  /** Detailed warnings; never fatal. */
  warnings?: string[];
}

export interface GradientColorStop {
  /** Stable id. Assigned when missing. */
  id: string;
  /** Normalized 0-1 position along the ramp. */
  position: number;
  /** Bias for the 50% blend point toward the next stop (0-1, default 0.5). */
  midpoint?: number;
  color: ManagedColor;
}

export interface GradientOpacityStop {
  /** Stable id. Assigned when missing. */
  id: string;
  /** Normalized 0-1 position along the ramp. */
  position: number;
  /** Bias for the 50% blend point toward the next stop (0-1, default 0.5). */
  midpoint?: number;
  /** Normalized 0-1 opacity. */
  opacity: number;
}

export interface GradientPreset {
  /** Stable id. */
  id: string;
  /** Display name. May be empty (Photoshop allows empty names). */
  name: string;
  kind: GradientPresetKind;
  colorStops: GradientColorStop[];
  opacityStops: GradientOpacityStop[];
  /** 0-1 smoothness (Photoshop smoothness 0-4096 normalized). Optional. */
  smoothness?: number;
  /** Default interpolation for this preset. Defaults to 'oklab'. */
  interpolation: GradientInterpolation;
  source?: GradientPresetSource;
  /** Original imported metadata for diagnostics / round-tripping. */
  originalMetadata?: Record<string, unknown>;
  compatibility?: GradientCompatibilityInfo;
  /** True when this preset is a snapshot embedded in a document. */
  embedded?: boolean;
}

export interface GradientPresetLike {
  id?: string;
  name?: string;
  kind?: GradientPresetKind;
  colorStops?: Array<Pick<GradientColorStop, 'position' | 'color'> & Partial<GradientColorStop>>;
  opacityStops?: Array<
    Pick<GradientOpacityStop, 'position' | 'opacity'> & Partial<GradientOpacityStop>
  >;
  smoothness?: number;
  interpolation?: GradientInterpolation;
  source?: GradientPresetSource;
  originalMetadata?: Record<string, unknown>;
  compatibility?: GradientCompatibilityInfo;
  embedded?: boolean;
}

/** Bounds for sanitization. */
export const GRADIENT_PRESET_LIMITS = {
  maxColorStops: 128,
  maxOpacityStops: 128,
  maxNameLength: 4096,
  minStopsForSolid: 1,
} as const;

/** Content-addressed id scheme (used for built-ins and dedup). */
export function gradientPresetIdFromHash(hash: string): string {
  return `gpreset-${hash}`;
}

function stableId(prefix: string, seed: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h1 ^= h2 >>> 16;
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  return `${prefix}${hex.slice(0, 12)}`;
}

function clamp01(v: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Sort + dedupe + clamp a list of stops, assigning stable ids when missing.
 * Duplicate positions keep the first stop and drop later duplicates with the
 * same position (deterministic).
 */
export function normalizeColorStops(stops: Array<Partial<GradientColorStop>>): GradientColorStop[] {
  const seen = new Map<number, GradientColorStop>();
  for (const raw of stops) {
    if (!raw.color) continue;
    const position = clamp01(raw.position ?? 0);
    const existing = seen.get(position);
    if (existing) continue;
    seen.set(position, {
      id: raw.id ?? stableId('cs-', `${position}|${managedColorFingerprint(raw.color)}`),
      position,
      ...(raw.midpoint !== undefined ? { midpoint: clamp01(raw.midpoint) } : {}),
      color: raw.color,
    });
  }
  return [...seen.values()].sort((a, b) => a.position - b.position);
}

/** Normalize opacity stops with the same rules as color stops. */
export function normalizeOpacityStops(
  stops: Array<Partial<GradientOpacityStop>>,
): GradientOpacityStop[] {
  const seen = new Map<number, GradientOpacityStop>();
  for (const raw of stops) {
    const position = clamp01(raw.position ?? 0);
    const existing = seen.get(position);
    if (existing) continue;
    seen.set(position, {
      id: stableId('os-', raw.id ?? `${position}`),
      position,
      ...(raw.midpoint !== undefined ? { midpoint: clamp01(raw.midpoint) } : {}),
      opacity: clamp01(raw.opacity ?? 1),
    });
  }
  return [...seen.values()].sort((a, b) => a.position - b.position);
}

/**
 * Build a well-formed `GradientPreset` from loose input. Assigns a stable id,
 * defaults interpolation to 'oklab', sorts/dedupes stops, and sanitizes all
 * numeric fields. Never throws; never returns partially-shaped stops.
 */
export function makeGradientPreset(input: GradientPresetLike): GradientPreset {
  const colorStops = normalizeColorStops(input.colorStops ?? []);
  const opacityStops = normalizeOpacityStops(
    input.opacityStops && input.opacityStops.length > 0
      ? input.opacityStops
      : [
          { position: 0, opacity: 1 },
          { position: 1, opacity: 1 },
        ],
  );
  const name = String(input.name ?? '').slice(0, GRADIENT_PRESET_LIMITS.maxNameLength);
  const base: Omit<GradientPreset, 'id'> = {
    name,
    kind: input.kind ?? 'solid',
    colorStops,
    opacityStops,
    ...(input.smoothness !== undefined ? { smoothness: clamp01(input.smoothness) } : {}),
    interpolation: input.interpolation ?? 'oklab',
    ...(input.source ? { source: input.source } : {}),
    ...(input.originalMetadata ? { originalMetadata: input.originalMetadata } : {}),
    ...(input.compatibility ? { compatibility: input.compatibility } : {}),
    ...(input.embedded ? { embedded: true } : {}),
  };
  const id = input.id ?? gradientPresetIdFromHash(gradientPresetContentHash({ ...base, id: '' }));
  return { ...base, id };
}

/** Deterministic content hash of the ramp (stops + interpolation + kind).
 *  Intentionally excludes `name` and `source`: two presets with the same ramp
 *  are content-identical even when their display names differ, and names must
 *  never be the basis for silently overwriting content. */
export function gradientPresetContentHash(preset: GradientPresetLike): string {
  const colors = (preset.colorStops ?? [])
    .map((s) => `${s.position}:${s.midpoint ?? 0.5}:${managedColorFingerprint(s.color)}`)
    .join(';');
  const opacities = (preset.opacityStops ?? [])
    .map((s) => `${s.position}:${s.midpoint ?? 0.5}:${s.opacity}`)
    .join(';');
  const parts = [
    preset.kind ?? 'solid',
    preset.interpolation ?? 'oklab',
    preset.smoothness ?? 0,
    colors,
    opacities,
  ];
  const joined = parts.join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0xc9b13e87;
  for (let i = 0; i < joined.length; i++) {
    const ch = joined.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch, 25165843);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function managedColorFingerprint(c: ManagedColor): string {
  switch (c.space) {
    case 'rgb':
      return `rgb:${c.r}:${c.g}:${c.b}:${c.a}`;
    case 'cmyk':
      return `cmyk:${c.c}:${c.m}:${c.y}:${c.k}:${c.a}`;
    case 'gray':
      return `gray:${c.v}:${c.a}`;
    case 'spot':
      return `spot:${c.name}:${c.tint}:${c.a}`;
  }
}

/**
 * Sample the opacity ramp at a normalized position using midpoint bias.
 * Extrapolates the endpoints when the position falls outside the stop range.
 */
export function sampleGradientOpacity(
  preset: Pick<GradientPreset, 'opacityStops'>,
  position: number,
): number {
  const stops = preset.opacityStops;
  if (stops.length === 0) return 1;
  if (stops.length === 1) return stops[0]!.opacity;
  if (position <= stops[0]!.position) return stops[0]!.opacity;
  const last = stops[stops.length - 1]!;
  if (position >= last.position) return last.opacity;
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i]!;
    const hi = stops[i + 1]!;
    if (position >= lo.position && position <= hi.position) {
      const span = hi.position - lo.position;
      const t = span === 0 ? 0 : (position - lo.position) / span;
      const midpoint = hi.midpoint ?? 0.5;
      const shaped = midpoint === 0.5 ? t : applySegmentMidpoint(t, midpoint);
      return lo.opacity + (hi.opacity - lo.opacity) * shaped;
    }
  }
  return last.opacity;
}

/** Figma-style piecewise midpoint bias (shared with color interpolation). */
export function applySegmentMidpoint(t: number, midpoint: number): number {
  const m = Math.max(0, Math.min(1, midpoint));
  if (m <= 0) return t <= 0 ? 0 : 1;
  if (m >= 1) return t >= 1 ? 1 : 0;
  if (t < m) return (t / m) * 0.5;
  return 0.5 + ((t - m) / (1 - m)) * 0.5;
}

/**
 * Deterministic duplicate handling. Presets compare by content hash; name
 * collisions without identical content are never silently overwritten.
 * Returns `{ merged, created }` where `created` are new ids and `merged`
 * maps existing ids to the incoming id (same content).
 */
export function mergeGradientPresets(
  existing: GradientPreset[],
  incoming: GradientPreset[],
): { merged: Map<string, string>; created: string[] } {
  const byHash = new Map<string, GradientPreset>();
  for (const p of existing) byHash.set(gradientPresetContentHash(p), p);
  const merged = new Map<string, string>();
  const created: string[] = [];
  for (const p of incoming) {
    const hash = gradientPresetContentHash(p);
    const match = byHash.get(hash);
    if (match) {
      merged.set(match.id, p.id);
    } else {
      created.push(p.id);
      byHash.set(hash, p);
    }
  }
  return { merged, created };
}

/** Pick the first non-empty display name for a preset (source-aware). */
export function displayName(preset: GradientPreset): string {
  if (preset.name && preset.name.trim().length > 0) return preset.name;
  if (preset.source?.originalName) return preset.source.originalName;
  return 'Untitled gradient';
}

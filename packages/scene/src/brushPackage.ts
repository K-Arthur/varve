/**
 * Portable brush presets.
 *
 * A brush that references a custom grain is only portable if the grain travels
 * with it. A preset carrying `grainId: "/home/me/Pictures/paper.png"` opens on
 * another machine as a brush with a missing texture, so an exported package
 * embeds the bytes of any *user* grain while referencing built-in grains by
 * their stable id — there is no point shipping a texture the recipient already
 * has, and no way to avoid shipping one they do not.
 *
 * Everything here treats its input as untrusted. A brush package is data, never
 * code: fields are validated and clamped individually, unknown fields are
 * dropped rather than spread onto a runtime object, and the decoded size of
 * embedded assets is bounded before anything is allocated.
 */

import { type BrushPreset, clampBrushPreset, validateBrushPreset } from './brush';

export const BRUSH_PACKAGE_FORMAT = 'varve-brush';
export const BRUSH_PACKAGE_VERSION = 1;

/** Cap on one embedded grain, decoded. Refuses zip-bomb-shaped input. */
export const MAX_EMBEDDED_GRAIN_BYTES = 16 * 1024 * 1024;
/** Cap on presets in a single package, so one file cannot exhaust memory. */
export const MAX_PACKAGE_PRESETS = 256;

export interface BrushGrainResource {
  /** Stable identity, independent of filename or any blob/object URL. */
  id: string;
  name: string;
  mimeType: string;
  /** Base64 payload, no data-URL prefix. */
  data: string;
  /** SHA-256 of the payload when the exporter could compute one. */
  contentHash?: string;
  width?: number;
  height?: number;
}

export interface BrushPackage {
  format: typeof BRUSH_PACKAGE_FORMAT;
  version: number;
  presets: BrushPreset[];
  /** Grain assets the presets depend on, keyed by resource id. */
  resources: BrushGrainResource[];
  exportedAt?: string;
  application?: string;
}

export type BrushImportIssueCode =
  | 'not-an-object'
  | 'wrong-format'
  | 'unsupported-version'
  | 'no-presets'
  | 'too-many-presets'
  | 'invalid-preset'
  | 'invalid-resource'
  | 'resource-too-large'
  | 'missing-resource';

export interface BrushImportIssue {
  code: BrushImportIssueCode;
  message: string;
  /** Which preset or resource the issue concerns, when applicable. */
  subject?: string;
}

export interface BrushImportResult {
  ok: boolean;
  presets: BrushPreset[];
  resources: BrushGrainResource[];
  issues: BrushImportIssue[];
}

const MIME_ALLOWLIST = new Set(['image/png', 'image/jpeg', 'image/webp']);
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Decoded byte length of a base64 payload, without decoding it. */
export function base64DecodedBytes(payload: string): number {
  const len = payload.length;
  if (len === 0) return 0;
  let padding = 0;
  if (payload.endsWith('==')) padding = 2;
  else if (payload.endsWith('=')) padding = 1;
  return (len / 4) * 3 - padding;
}

/** Which grain ids a set of presets depends on. */
export function collectGrainDependencies(presets: readonly BrushPreset[]): string[] {
  const ids = new Set<string>();
  for (const preset of presets) {
    if (preset.grainId && preset.grainId !== 'procedural') ids.add(preset.grainId);
  }
  return [...ids];
}

export interface ExportOptions {
  /** Resolve a grain id to its bytes. Return null for built-ins. */
  resolveResource?: (grainId: string) => BrushGrainResource | null;
  application?: string;
  now?: () => Date;
}

/**
 * Build a portable package for `presets`.
 *
 * Grains that `resolveResource` declines to provide are left as bare id
 * references — that is the correct outcome for built-ins, which the recipient
 * resolves locally, and duplicating their bytes into every export would bloat
 * files for no benefit.
 */
export function exportBrushPackage(
  presets: readonly BrushPreset[],
  options: ExportOptions = {},
): BrushPackage {
  const resources: BrushGrainResource[] = [];
  const seen = new Set<string>();
  for (const grainId of collectGrainDependencies(presets)) {
    const resource = options.resolveResource?.(grainId) ?? null;
    if (!resource) continue;
    // Deduplicate by content: importing the same texture under two names must
    // not embed it twice.
    const dedupeKey = resource.contentHash ?? resource.id;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    resources.push(resource);
  }
  return {
    format: BRUSH_PACKAGE_FORMAT,
    version: BRUSH_PACKAGE_VERSION,
    presets: presets.map((p) => clampBrushPreset(p)),
    resources,
    exportedAt: (options.now?.() ?? new Date()).toISOString(),
    application: options.application ?? 'Varve',
  };
}

export function serializeBrushPackage(pkg: BrushPackage): string {
  return JSON.stringify(pkg, null, 2);
}

/**
 * Parse and validate an untrusted brush package.
 *
 * Returns every problem it found rather than the first, so a user importing a
 * pack of forty brushes learns which three are broken instead of being told
 * only about one. A preset that fails validation is dropped, never partially
 * applied — half a brush is worse than a clear refusal.
 */
export function importBrushPackage(raw: unknown): BrushImportResult {
  const issues: BrushImportIssue[] = [];
  const fail = (code: BrushImportIssueCode, message: string): BrushImportResult => {
    issues.push({ code, message });
    return { ok: false, presets: [], resources: [], issues };
  };

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail('not-an-object', 'File is not valid JSON.');
    }
  }
  if (!isRecord(parsed)) return fail('not-an-object', 'Brush file is not an object.');
  if (parsed.format !== BRUSH_PACKAGE_FORMAT) {
    return fail('wrong-format', 'This file is not a Varve brush package.');
  }
  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('unsupported-version', 'Brush package has no usable version.');
  }
  if (version > BRUSH_PACKAGE_VERSION) {
    return fail(
      'unsupported-version',
      `Brush package version ${version} is newer than this version of Varve supports.`,
    );
  }
  if (!Array.isArray(parsed.presets) || parsed.presets.length === 0) {
    return fail('no-presets', 'Brush package contains no presets.');
  }
  if (parsed.presets.length > MAX_PACKAGE_PRESETS) {
    return fail(
      'too-many-presets',
      `Brush package contains ${parsed.presets.length} presets; the limit is ${MAX_PACKAGE_PRESETS}.`,
    );
  }

  const resources: BrushGrainResource[] = [];
  const resourceIds = new Set<string>();
  if (Array.isArray(parsed.resources)) {
    for (const entry of parsed.resources) {
      const resource = validateResource(entry, issues);
      if (!resource) continue;
      if (resourceIds.has(resource.id)) continue;
      resourceIds.add(resource.id);
      resources.push(resource);
    }
  }

  const presets: BrushPreset[] = [];
  const presetIds = new Set<string>();
  for (const entry of parsed.presets) {
    // validateBrushPreset rebuilds the object field by field, so unknown or
    // hostile keys on the input never reach a runtime brush.
    const preset = validateBrushPreset(entry);
    if (!preset) {
      issues.push({
        code: 'invalid-preset',
        message: 'Preset could not be read and was skipped.',
        subject: isRecord(entry) && typeof entry.name === 'string' ? entry.name : undefined,
      });
      continue;
    }
    if (presetIds.has(preset.id)) {
      issues.push({
        code: 'invalid-preset',
        message: `Duplicate preset id "${preset.id}" in package; only the first was kept.`,
        subject: preset.name,
      });
      continue;
    }
    presetIds.add(preset.id);
    if (preset.grainId && preset.grainId !== 'procedural' && !resourceIds.has(preset.grainId)) {
      // Not fatal: the grain may be a built-in the recipient already has. The
      // reference is preserved so it resolves if present and reports missing
      // if not, rather than being silently swapped for another texture.
      issues.push({
        code: 'missing-resource',
        message: `"${preset.name}" references grain "${preset.grainId}", which is not in the package.`,
        subject: preset.name,
      });
    }
    presets.push(preset);
  }

  if (presets.length === 0) {
    issues.push({ code: 'no-presets', message: 'No presets in the package could be read.' });
    return { ok: false, presets: [], resources, issues };
  }
  return { ok: true, presets, resources, issues };
}

function validateResource(entry: unknown, issues: BrushImportIssue[]): BrushGrainResource | null {
  if (!isRecord(entry)) {
    issues.push({ code: 'invalid-resource', message: 'Grain resource is not an object.' });
    return null;
  }
  const id = entry.id;
  if (typeof id !== 'string' || !RESOURCE_ID_PATTERN.test(id)) {
    // Rejecting anything path-shaped is what stops a package writing outside
    // wherever a host chooses to store imported assets.
    issues.push({ code: 'invalid-resource', message: 'Grain resource has an unusable id.' });
    return null;
  }
  const mimeType = entry.mimeType;
  if (typeof mimeType !== 'string' || !MIME_ALLOWLIST.has(mimeType)) {
    issues.push({
      code: 'invalid-resource',
      message: `Grain "${id}" has an unsupported type.`,
      subject: id,
    });
    return null;
  }
  const data = entry.data;
  if (typeof data !== 'string' || !BASE64_PATTERN.test(data) || data.length === 0) {
    issues.push({
      code: 'invalid-resource',
      message: `Grain "${id}" has no readable image data.`,
      subject: id,
    });
    return null;
  }
  const bytes = base64DecodedBytes(data);
  if (bytes > MAX_EMBEDDED_GRAIN_BYTES) {
    issues.push({
      code: 'resource-too-large',
      message: `Grain "${id}" is ${Math.round(bytes / 1024 / 1024)} MB, over the ${
        MAX_EMBEDDED_GRAIN_BYTES / 1024 / 1024
      } MB limit.`,
      subject: id,
    });
    return null;
  }
  return {
    id,
    name: typeof entry.name === 'string' ? entry.name : id,
    mimeType,
    data,
    contentHash: typeof entry.contentHash === 'string' ? entry.contentHash : undefined,
    width: Number.isFinite(entry.width) ? (entry.width as number) : undefined,
    height: Number.isFinite(entry.height) ? (entry.height as number) : undefined,
  };
}

export type ImportCollisionPolicy = 'replace' | 'copy' | 'skip';

export interface CollisionResolution {
  preset: BrushPreset;
  /** What happened to this preset. */
  action: 'added' | 'replaced' | 'copied' | 'skipped';
}

/**
 * Resolve id collisions against an existing library.
 *
 * There is deliberately no silent-overwrite path: replacing a brush the user
 * has tuned is destructive and must be an explicit choice.
 */
export function resolveImportCollisions(
  incoming: readonly BrushPreset[],
  existingIds: ReadonlySet<string>,
  policy: ImportCollisionPolicy,
  makeId: (base: string) => string = (base) => `${base}-copy`,
): CollisionResolution[] {
  const taken = new Set(existingIds);
  return incoming.map((preset) => {
    if (!taken.has(preset.id)) {
      taken.add(preset.id);
      return { preset, action: 'added' as const };
    }
    if (policy === 'replace') return { preset, action: 'replaced' as const };
    if (policy === 'skip') return { preset, action: 'skipped' as const };
    let id = makeId(preset.id);
    let n = 2;
    while (taken.has(id)) id = `${makeId(preset.id)}-${n++}`;
    taken.add(id);
    return {
      preset: { ...preset, id, name: `${preset.name} copy` },
      action: 'copied' as const,
    };
  });
}

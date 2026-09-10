/**
 * Mockup template and instance validation.
 *
 * Templates imported from JSON (user/community) are untrusted input:
 * every number, shape, reference, and licence field is validated here before
 * it can reach the document. Invalid templates are rejected with explicit
 * findings; borderline data (out-of-bounds shapes, unknown blend modes) is
 * either clamped or surfaced as a warning.
 */

import { isQuadValid } from '@varve/engine';
import type {
  MockupInstanceData,
  MockupQuad,
  MockupSurfaceDefinition,
  MockupTemplateAsset,
  MockupVectorShape,
} from './types';

export interface MockupValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export const MOCKUP_LIMITS = {
  maxShapes: 512,
  maxSurfaces: 32,
  maxOutputDimension: 16_384,
  minOutputDimension: 8,
  maxShapeCountPerSurface: 128,
  maxGeometryMagnitude: 1_000_000,
  maxTemplateBytes: 1_048_576,
} as const;

const KNOWN_SURFACE_KINDS = new Set(['flat', 'quad', 'mesh', 'cylindrical']);
const IMPLEMENTED_SURFACE_KINDS = new Set(['flat', 'quad']);
const KNOWN_FIT_MODES = new Set(['contain', 'cover', 'stretch', 'native']);
const KNOWN_ALIGNS = new Set(['min', 'center', 'max']);
const KNOWN_CATEGORIES = new Set([
  'devices',
  'browser-desktop',
  'print',
  'stationery',
  'packaging',
  'apparel',
  'signage',
  'social-marketing',
  'logo',
]);
const KNOWN_SOURCES = new Set(['builtin', 'user', 'workspace', 'community']);
const KNOWN_ORIENTATIONS = new Set(['portrait', 'landscape', 'square', 'any']);
const KNOWN_OVERLAY_KINDS = new Set(['shadow', 'highlight', 'reflection', 'vignette', 'grain']);
const KNOWN_OVERLAY_BLEND_MODES = new Set([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
  'color-dodge',
  'color-burn',
  'darken',
  'lighten',
  'difference',
  'exclusion',
]);
/** Very loose CSS color check; full parsing happens at render with a safe fallback. */
const CSS_COLOR_RE = /^(transparent|#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-zA-Z]+)$/;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** True when a quad has finite coordinates and is usable for homography. */
export function isValidMockupQuad(quad: MockupQuad | undefined | null): quad is MockupQuad {
  if (!Array.isArray(quad) || quad.length !== 4) return false;
  return isQuadValid(quad as unknown as [never, never, never, never]);
}

/** True when the color is plausibly a CSS color. */
export function isPlausibleCssColor(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 64 && CSS_COLOR_RE.test(value);
}

export function validateVectorShape(shape: unknown, errors: string[]): shape is MockupVectorShape {
  if (!shape || typeof shape !== 'object') {
    errors.push('shape must be an object');
    return false;
  }
  const s = shape as Record<string, unknown>;
  if (s.kind !== 'rect' && s.kind !== 'ellipse') {
    errors.push(`unknown shape kind: ${String(s.kind)}`);
    return false;
  }
  const required = ['x', 'y', 'width', 'height', 'fill'];
  for (const key of required) {
    if (key === 'fill') {
      if (!isPlausibleCssColor(s.fill)) {
        errors.push(`invalid shape fill color: ${String(s.fill)}`);
        return false;
      }
      continue;
    }
    if (!isFiniteNumber(s[key])) {
      errors.push(`shape ${key} must be a finite number`);
      return false;
    }
  }
  if (typeof s.width === 'number' && s.width <= 0) {
    errors.push('shape width must be positive');
    return false;
  }
  if (typeof s.height === 'number' && s.height <= 0) {
    errors.push('shape height must be positive');
    return false;
  }
  if (s.opacity !== undefined && (!isFiniteNumber(s.opacity) || s.opacity < 0 || s.opacity > 1)) {
    errors.push('shape opacity must be within [0, 1]');
    return false;
  }
  if (s.rotation !== undefined && !isFiniteNumber(s.rotation)) {
    errors.push('shape rotation must be finite');
    return false;
  }
  return true;
}

export function validateSurface(
  surface: unknown,
  errors: string[],
  warnings: string[],
  template: { outputWidth: number; outputHeight: number },
): surface is MockupSurfaceDefinition {
  if (!surface || typeof surface !== 'object') {
    errors.push('surface must be an object');
    return false;
  }
  const s = surface as Record<string, unknown>;
  if (typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 128) {
    errors.push('surface id must be a non-empty string (<= 128 chars)');
    return false;
  }
  if (typeof s.name !== 'string') {
    errors.push(`surface ${s.id}: name must be a string`);
    return false;
  }
  if (!KNOWN_SURFACE_KINDS.has(String(s.kind))) {
    errors.push(`surface ${s.id}: unknown kind ${String(s.kind)}`);
    return false;
  }
  if (!IMPLEMENTED_SURFACE_KINDS.has(String(s.kind))) {
    errors.push(`surface ${s.id}: kind ${String(s.kind)} is reserved (not implemented)`);
    return false;
  }
  if (typeof s.sourceSlot !== 'string' || s.sourceSlot.length === 0) {
    errors.push(`surface ${s.id}: missing sourceSlot`);
    return false;
  }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!isFiniteNumber(s[key])) {
      errors.push(`surface ${s.id}: ${key} must be a finite number`);
      return false;
    }
  }
  const sw = s.width as number;
  const sh = s.height as number;
  const sx = s.x as number;
  const sy = s.y as number;
  if (sw <= 0 || sh <= 0) {
    errors.push(`surface ${s.id}: slot must have positive size`);
    return false;
  }
  if (
    sx < -MOCKUP_LIMITS.maxGeometryMagnitude ||
    sy < -MOCKUP_LIMITS.maxGeometryMagnitude ||
    sx + sw > MOCKUP_LIMITS.maxGeometryMagnitude ||
    sy + sh > MOCKUP_LIMITS.maxGeometryMagnitude
  ) {
    errors.push(`surface ${s.id}: slot exceeds geometry limits`);
    return false;
  }
  if (!KNOWN_FIT_MODES.has(String(s.fit))) {
    errors.push(`surface ${s.id}: unknown fit mode ${String(s.fit)}`);
    return false;
  }
  const alignment = s.alignment as Record<string, unknown> | undefined;
  if (
    !alignment ||
    !KNOWN_ALIGNS.has(String(alignment.x)) ||
    !KNOWN_ALIGNS.has(String(alignment.y))
  ) {
    errors.push(`surface ${s.id}: invalid alignment`);
    return false;
  }
  if (s.kind === 'quad') {
    if (!isValidMockupQuad(s.quad as MockupQuad)) {
      errors.push(`surface ${s.id}: invalid quad (crossing, concave, or non-finite)`);
      return false;
    }
  }
  if (s.plate !== undefined) {
    if (!Array.isArray(s.plate) || s.plate.length > MOCKUP_LIMITS.maxShapeCountPerSurface) {
      errors.push(`surface ${s.id}: plate shape count exceeds limit`);
      return false;
    }
    for (const shape of s.plate) {
      if (!validateVectorShape(shape, errors)) return false;
    }
  }
  if (s.platePadding !== undefined) {
    const p = s.platePadding as Record<string, unknown>;
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y) || p.x < 0 || p.y < 0) {
      errors.push(`surface ${s.id}: invalid platePadding`);
      return false;
    }
  }
  if (s.shadow !== undefined && s.shadow !== null) {
    const sh = s.shadow as Record<string, unknown>;
    if (
      !isFiniteNumber(sh.blur) ||
      !isFiniteNumber(sh.offsetY) ||
      !isFiniteNumber(sh.opacity) ||
      sh.blur < 0 ||
      sh.opacity < 0 ||
      sh.opacity > 1
    ) {
      errors.push(`surface ${s.id}: invalid shadow`);
      return false;
    }
  }
  // Reserved fields (Level 3/4) must not be set on templates we can't render.
  for (const reserved of ['clipMaskAssetId', 'occlusionMaskAssetId', 'displacementAssetId']) {
    if (s[reserved] !== undefined) {
      errors.push(`surface ${s.id}: ${reserved} is reserved and not yet supported`);
      return false;
    }
  }
  // Out-of-output-bounds slots degrade the presentation; warn (builtins are
  // reviewed, user templates get a finding that blocks import).
  if (
    sx < 0 ||
    sy < 0 ||
    sx + sw > template.outputWidth + 0.5 ||
    sy + sh > template.outputHeight + 0.5
  ) {
    warnings.push(`surface ${s.id}: extends beyond the template output bounds`);
  }
  return true;
}

export function validateTemplate(template: unknown): MockupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!template || typeof template !== 'object') {
    return { ok: false, errors: ['template must be an object'], warnings };
  }
  const t = template as Record<string, unknown>;
  if (typeof t.id !== 'string' || t.id.length === 0 || t.id.length > 256) {
    errors.push('template id must be a non-empty string (<= 256 chars)');
  }
  if (!isFiniteNumber(t.schemaVersion) || t.schemaVersion !== 1) {
    errors.push(`unsupported schemaVersion: ${String(t.schemaVersion)}`);
  }
  if (typeof t.name !== 'string' || t.name.length === 0) {
    errors.push('template name must be a non-empty string');
  }
  if (!KNOWN_CATEGORIES.has(String(t.category))) {
    errors.push(`unknown category: ${String(t.category)}`);
  }
  if (!KNOWN_SOURCES.has(String(t.source))) {
    errors.push(`unknown source: ${String(t.source)}`);
  }
  if (!KNOWN_ORIENTATIONS.has(String(t.orientation))) {
    errors.push(`unknown orientation: ${String(t.orientation)}`);
  }
  if (!isFiniteNumber(t.outputWidth) || !isFiniteNumber(t.outputHeight)) {
    errors.push('output dimensions must be finite numbers');
  } else {
    if (
      t.outputWidth < MOCKUP_LIMITS.minOutputDimension ||
      t.outputHeight < MOCKUP_LIMITS.minOutputDimension
    ) {
      errors.push('output dimensions below the minimum');
    }
    if (
      t.outputWidth > MOCKUP_LIMITS.maxOutputDimension ||
      t.outputHeight > MOCKUP_LIMITS.maxOutputDimension
    ) {
      errors.push('output dimensions exceed the maximum');
    }
  }
  if (!isPlausibleCssColor(t.backgroundColor)) {
    errors.push('invalid backgroundColor');
  }
  if (t.plate !== undefined) {
    if (!Array.isArray(t.plate) || t.plate.length > MOCKUP_LIMITS.maxShapes) {
      errors.push('plate shape count exceeds limit');
    } else {
      for (const shape of t.plate) {
        if (!validateVectorShape(shape, errors)) break;
      }
    }
  }
  if (!Array.isArray(t.surfaces) || t.surfaces.length === 0) {
    errors.push('template must define at least one surface');
  } else if (t.surfaces.length > MOCKUP_LIMITS.maxSurfaces) {
    errors.push(`surface count exceeds limit (${MOCKUP_LIMITS.maxSurfaces})`);
  } else {
    const ids = new Set<string>();
    const slots = new Set<string>();
    const templateDims = {
      outputWidth: t.outputWidth as number,
      outputHeight: t.outputHeight as number,
    };
    for (const surface of t.surfaces) {
      if (!validateSurface(surface, errors, warnings, templateDims)) continue;
      const s = surface as MockupSurfaceDefinition;
      if (ids.has(s.id)) {
        errors.push(`duplicate surface id: ${s.id}`);
        continue;
      }
      ids.add(s.id);
      if (slots.has(s.sourceSlot)) {
        warnings.push(`duplicate sourceSlot: ${s.sourceSlot}`);
      }
      slots.add(s.sourceSlot);
    }
  }
  if (t.overlays !== undefined) {
    if (!Array.isArray(t.overlays)) {
      errors.push('overlays must be an array');
    } else {
      for (const overlay of t.overlays) {
        if (!overlay || typeof overlay !== 'object') {
          errors.push('overlay must be an object');
          continue;
        }
        const o = overlay as Record<string, unknown>;
        if (!KNOWN_OVERLAY_KINDS.has(String(o.kind))) {
          errors.push(`unknown overlay kind: ${String(o.kind)}`);
        }
        if (!isFiniteNumber(o.opacity) || o.opacity < 0 || o.opacity > 1) {
          errors.push('overlay opacity must be within [0, 1]');
        }
        if (o.blendMode !== undefined && !KNOWN_OVERLAY_BLEND_MODES.has(String(o.blendMode))) {
          errors.push(`unsupported overlay blend mode: ${String(o.blendMode)}`);
        }
        if (!Array.isArray(o.shapes)) {
          errors.push('overlay must define shapes');
        } else {
          for (const shape of o.shapes) {
            if (!validateVectorShape(shape, errors)) break;
          }
        }
      }
    }
  }
  if (t.licence !== undefined && !validateLicence(t.licence, errors)) {
    // findings appended by validateLicence
  }
  if (typeof t.contentHash !== 'string') {
    errors.push('contentHash must be a string');
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function validateLicence(licence: unknown, errors: string[]): boolean {
  if (!licence || typeof licence !== 'object') {
    errors.push('licence must be an object');
    return false;
  }
  const l = licence as Record<string, unknown>;
  if (typeof l.title !== 'string' || l.title.length === 0 || l.title.length > 256) {
    errors.push('licence title must be a non-empty string');
  }
  if (l.spdx !== undefined && (typeof l.spdx !== 'string' || l.spdx.length > 128)) {
    errors.push('licence spdx must be a short string');
  }
  if (l.url !== undefined && (typeof l.url !== 'string' || l.url.length > 2048)) {
    errors.push('licence url must be a short string');
  }
  if (typeof l.creator !== 'string' || l.creator.length === 0) {
    errors.push('licence creator is required');
  }
  for (const key of ['commercialUse', 'modification', 'redistribution'] as const) {
    if (l[key] !== undefined && l[key] !== 'yes' && l[key] !== 'no' && l[key] !== 'unknown') {
      errors.push(`licence ${key} must be yes|no|unknown`);
    }
  }
  return errors.length === 0;
}

/** Validate a frame's mockup instance payload against the document. */
export function validateInstance(
  doc: { mockupTemplates?: Record<string, MockupTemplateAsset>; nodes?: Record<string, unknown> },
  instance: MockupInstanceData,
): MockupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof instance.templateId !== 'string') {
    errors.push('instance templateId must be a string');
    return { ok: false, errors, warnings };
  }
  const template = doc.mockupTemplates?.[instance.templateId];
  if (!template) {
    errors.push(`instance references missing template ${instance.templateId}`);
    return { ok: false, errors, warnings };
  }
  const surfaceIds = new Set(template.surfaces.map((s) => s.id));
  if (!instance.surfaceBindings || typeof instance.surfaceBindings !== 'object') {
    errors.push('instance must define surfaceBindings');
    return { ok: false, errors, warnings };
  }
  for (const [surfaceId, binding] of Object.entries(instance.surfaceBindings)) {
    if (!surfaceIds.has(surfaceId)) {
      errors.push(`binding references unknown surface ${surfaceId}`);
      continue;
    }
    if (!binding || typeof binding !== 'object') {
      errors.push(`binding for ${surfaceId} must be an object`);
      continue;
    }
    if (binding.mode !== 'live' && binding.mode !== 'snapshot') {
      errors.push(`binding for ${surfaceId}: unknown mode ${String(binding.mode)}`);
      continue;
    }
    if (binding.mode === 'live') {
      if (typeof binding.nodeId !== 'string' || !doc.nodes?.[binding.nodeId]) {
        errors.push(
          `binding for ${surfaceId}: live source ${String(binding.nodeId)} does not exist`,
        );
      }
    } else if (typeof binding.assetId !== 'string') {
      errors.push(`binding for ${surfaceId}: snapshot requires assetId`);
    }
  }
  if (instance.overrides !== undefined) {
    for (const [surfaceId, override] of Object.entries(instance.overrides)) {
      if (!surfaceIds.has(surfaceId)) {
        errors.push(`override references unknown surface ${surfaceId}`);
        continue;
      }
      if (!override || typeof override !== 'object') continue;
      const o = override as Record<string, unknown>;
      if (o.quad !== undefined && !isValidMockupQuad(o.quad as MockupQuad)) {
        errors.push(`override for ${surfaceId}: invalid quad`);
      }
      if (o.fit !== undefined && !KNOWN_FIT_MODES.has(String(o.fit))) {
        errors.push(`override for ${surfaceId}: unknown fit ${String(o.fit)}`);
      }
      if (o.shadow !== undefined && o.shadow !== null) {
        const sh = o.shadow as Record<string, unknown>;
        if (!isFiniteNumber(sh.blur) || !isFiniteNumber(sh.opacity)) {
          errors.push(`override for ${surfaceId}: invalid shadow`);
        }
      }
      if (o.rotation !== undefined && !isFiniteNumber(o.rotation)) {
        errors.push(`override for ${surfaceId}: invalid rotation`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

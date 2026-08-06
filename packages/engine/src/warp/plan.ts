/**
 * Typed warp-proposal boundary.
 *
 * The multimodal warp pipeline (and the deterministic "fit to target"
 * workflows) must never mutate the document directly. Every proposal is a
 * schema-validated `WarpPlan`; the editor applies it through ordinary
 * commands inside one undo transaction. Model output is treated as
 * untrusted: `validateWarpPlan` rejects non-finite coordinates, oversized
 * meshes, unknown modifier kinds, and structural mismatch before anything
 * reaches the scene.
 */

import { MAX_MESH_DIMENSION, validateWarpModifier, type WarpModifier } from './types';

export const WARP_PLAN_SCHEMA_VERSION = 1;

export interface WarpPlanWarning {
  code: string;
  message: string;
}

export interface WarpPlan {
  schemaVersion: number;
  requestId: string;
  selectionRevision: string;
  sourceNodeIds: string[];
  modifier: WarpModifier;
  confidence?: number;
  warnings: WarpPlanWarning[];
  assumptions: string[];
  derivedFrom: 'user' | 'deterministic-path' | 'deterministic-quad' | 'model-image';
}

export interface WarpPlanValidationResult {
  plan: WarpPlan | null;
  errors: string[];
}

const KNOWN_PLAN_KINDS = new Set(['skew', 'perspective', 'envelope', 'mesh-warp', 'bend']);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isWarningArray(v: unknown): v is WarpPlanWarning[] {
  return (
    Array.isArray(v) &&
    v.every(
      (w) =>
        typeof w === 'object' &&
        w !== null &&
        typeof (w as Record<string, unknown>).code === 'string' &&
        typeof (w as Record<string, unknown>).message === 'string',
    )
  );
}

/**
 * Validate a raw proposal. Returns null (with errors) when the plan cannot
 * be applied safely. Never throws.
 */
export function validateWarpPlan(raw: unknown): WarpPlanValidationResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { plan: null, errors: ['plan is not an object'] };
  }
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== WARP_PLAN_SCHEMA_VERSION) {
    errors.push(`unsupported plan schemaVersion ${String(p.schemaVersion)}`);
  }
  if (typeof p.requestId !== 'string' || p.requestId.length === 0) {
    errors.push('plan missing requestId');
  }
  if (typeof p.selectionRevision !== 'string' || p.selectionRevision.length === 0) {
    errors.push('plan missing selectionRevision');
  }
  if (!isStringArray(p.sourceNodeIds) || p.sourceNodeIds.length === 0) {
    errors.push('plan sourceNodeIds must be a non-empty string array');
  }
  if (!isWarningArray(p.warnings)) {
    errors.push('plan warnings must be an array of {code, message}');
  }
  if (!isStringArray(p.assumptions)) {
    errors.push('plan assumptions must be a string array');
  }
  if (
    p.confidence !== undefined &&
    (typeof p.confidence !== 'number' ||
      !Number.isFinite(p.confidence) ||
      p.confidence < 0 ||
      p.confidence > 1)
  ) {
    errors.push('plan confidence must be a finite number in 0..1');
  }
  if (
    !['user', 'deterministic-path', 'deterministic-quad', 'model-image'].includes(
      p.derivedFrom as string,
    )
  ) {
    errors.push('plan derivedFrom must be a known source');
  }

  const modifier = validateWarpModifier(p.modifier);
  if (!modifier) {
    errors.push('plan modifier failed structural validation');
  } else if (!KNOWN_PLAN_KINDS.has(modifier.kind)) {
    // Unknown kinds are preserved inert in documents, but an inert proposal
    // would silently do nothing — reject it instead.
    errors.push(`plan modifier kind "${modifier.kind}" is not supported`);
  } else if (
    modifier.kind === 'mesh-warp' &&
    (modifier.rows > MAX_MESH_DIMENSION || modifier.columns > MAX_MESH_DIMENSION)
  ) {
    errors.push(`plan mesh exceeds ${MAX_MESH_DIMENSION}x${MAX_MESH_DIMENSION}`);
  }

  if (errors.length > 0) {
    return { plan: null, errors };
  }
  return {
    plan: {
      schemaVersion: WARP_PLAN_SCHEMA_VERSION,
      requestId: p.requestId as string,
      selectionRevision: p.selectionRevision as string,
      sourceNodeIds: p.sourceNodeIds as string[],
      modifier: modifier as WarpModifier,
      ...(p.confidence !== undefined ? { confidence: p.confidence as number } : {}),
      warnings: p.warnings as WarpPlanWarning[],
      assumptions: p.assumptions as string[],
      derivedFrom: p.derivedFrom as WarpPlan['derivedFrom'],
    },
    errors,
  };
}

/** Build a typed plan from validated parts (internal use). */
export function makeWarpPlan(
  requestId: string,
  selectionRevision: string,
  sourceNodeIds: string[],
  modifier: WarpModifier,
  derivedFrom: WarpPlan['derivedFrom'],
  extras: Partial<Pick<WarpPlan, 'confidence' | 'warnings' | 'assumptions'>> = {},
): WarpPlan {
  const plan: WarpPlan = {
    schemaVersion: WARP_PLAN_SCHEMA_VERSION,
    requestId,
    selectionRevision,
    sourceNodeIds,
    modifier,
    warnings: extras.warnings ?? [],
    assumptions: extras.assumptions ?? [],
    derivedFrom,
  };
  if (extras.confidence !== undefined) plan.confidence = extras.confidence;
  const validation = validateWarpPlan(plan);
  if (!validation.plan) {
    throw new Error(`makeWarpPlan produced an invalid plan: ${validation.errors.join('; ')}`);
  }
  return validation.plan;
}

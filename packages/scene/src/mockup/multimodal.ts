/**
 * Multimodal mockup pipeline — typed request surface (Level 5).
 *
 * This module ships the *contract* for multimodal assistance (Stage A:
 * gather inputs; Stage B: classify intent) so UI and future model-backed
 * stages have a validated, typed boundary. The analysis/segmentation
 * stages (C-H) are deferred: see docs/plans/mockup-multimodal-deferred.md.
 *
 * Invariants:
 * - The pipeline never mutates the document from a model response.
 * - Unknown or contradictory request values are rejected, not guessed.
 * - AI output (when it exists) is inspectable and manually correctable.
 */

export type MockupTargetKind =
  | 'phone'
  | 'tablet'
  | 'laptop'
  | 'browser'
  | 'desktop'
  | 'poster'
  | 'print'
  | 'stationery'
  | 'packaging'
  | 'apparel'
  | 'signage'
  | 'custom-photo';

export type MockupPlacementMode = 'flat' | 'quad' | 'mesh' | 'cylindrical' | 'auto';

export interface MockupRequest {
  sourceNodeIds: string[];
  templateId?: string;
  targetKind: MockupTargetKind;
  placementMode: MockupPlacementMode;
  preserveSourceLink: boolean;
  requestedVariants?: number;
  textInstruction?: string;
}

export interface MockupIntentClassification {
  request: MockupRequest;
  /** Which template categories the intent maps to (ordered by fit). */
  suggestedCategories: string[];
  /** Deterministic placement mode when the user asked for 'auto'. */
  resolvedPlacementMode: Exclude<MockupPlacementMode, 'auto'>;
  warnings: string[];
}

const TARGET_KINDS = new Set<MockupTargetKind>([
  'phone',
  'tablet',
  'laptop',
  'browser',
  'desktop',
  'poster',
  'print',
  'stationery',
  'packaging',
  'apparel',
  'signage',
  'custom-photo',
]);

const PLACEMENT_MODES = new Set<MockupPlacementMode>([
  'flat',
  'quad',
  'mesh',
  'cylindrical',
  'auto',
]);

export const TARGET_KIND_CATEGORIES: Record<MockupTargetKind, string[]> = {
  phone: ['devices'],
  tablet: ['devices'],
  laptop: ['browser-desktop'],
  browser: ['browser-desktop'],
  desktop: ['browser-desktop'],
  poster: ['print', 'signage'],
  print: ['print', 'stationery'],
  stationery: ['stationery'],
  packaging: ['packaging'],
  apparel: ['apparel'],
  signage: ['signage', 'print'],
  'custom-photo': ['custom-photo', 'devices'],
};

export function validateMockupRequest(value: unknown): MockupRequest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.sourceNodeIds) || v.sourceNodeIds.length === 0) return null;
  if (!v.sourceNodeIds.every((id) => typeof id === 'string' && id.length > 0)) return null;
  if (v.templateId !== undefined && typeof v.templateId !== 'string') return null;
  if (typeof v.targetKind !== 'string' || !TARGET_KINDS.has(v.targetKind as MockupTargetKind)) {
    return null;
  }
  if (
    typeof v.placementMode !== 'string' ||
    !PLACEMENT_MODES.has(v.placementMode as MockupPlacementMode)
  ) {
    return null;
  }
  if (typeof v.preserveSourceLink !== 'boolean') return null;
  if (v.requestedVariants !== undefined) {
    if (
      typeof v.requestedVariants !== 'number' ||
      v.requestedVariants < 1 ||
      v.requestedVariants > 12
    ) {
      return null;
    }
  }
  if (v.textInstruction !== undefined && typeof v.textInstruction !== 'string') return null;
  return {
    sourceNodeIds: v.sourceNodeIds as string[],
    templateId: v.templateId,
    targetKind: v.targetKind as MockupTargetKind,
    placementMode: v.placementMode as MockupPlacementMode,
    preserveSourceLink: v.preserveSourceLink,
    requestedVariants: v.requestedVariants,
    textInstruction: v.textInstruction,
  };
}

/** Deterministic default placement mode per target kind (used for 'auto'). */
export function defaultPlacementModeFor(targetKind: MockupTargetKind): 'flat' | 'quad' {
  switch (targetKind) {
    case 'phone':
    case 'tablet':
    case 'browser':
    case 'desktop':
      return 'flat';
    case 'laptop':
    case 'poster':
    case 'packaging':
    case 'signage':
    case 'print':
    case 'stationery':
      return 'quad';
    case 'apparel':
    case 'custom-photo':
      return 'flat';
  }
}

/** Contradictory requests: mesh/cylindrical are reserved (Level 3). */
export function classifyMockupIntent(
  raw: unknown,
): MockupIntentClassification | { errors: string[] } {
  const request = validateMockupRequest(raw);
  if (!request) {
    return {
      errors: [
        'request failed schema validation: check sourceNodeIds, targetKind, placementMode, preserveSourceLink',
      ],
    };
  }
  const warnings: string[] = [];
  if (request.placementMode === 'mesh' || request.placementMode === 'cylindrical') {
    warnings.push('mesh and cylindrical placement are not implemented yet; falling back to flat');
  }
  if (request.requestedVariants !== undefined && request.requestedVariants > 1) {
    warnings.push('batch variants are not implemented yet; one mockup will be created');
  }
  const resolvedPlacementMode =
    request.placementMode === 'auto'
      ? defaultPlacementModeFor(request.targetKind)
      : request.placementMode === 'mesh' || request.placementMode === 'cylindrical'
        ? 'flat'
        : request.placementMode;
  return {
    request,
    suggestedCategories: TARGET_KIND_CATEGORIES[request.targetKind],
    resolvedPlacementMode,
    warnings,
  };
}

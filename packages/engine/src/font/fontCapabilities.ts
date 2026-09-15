/**
 * Runtime capability projection for one exact font face.
 *
 * A family name is only catalog metadata. Consumers need to know whether the
 * requested bytes, parsed face, renderer, worker, and operation permissions
 * are actually usable. This deliberately keeps technical readiness separate
 * from license provenance and from the authored font identity.
 */

export type CatalogCapability = 'present' | 'missing';
export type StoredBytesCapability = 'available' | 'missing' | 'corrupt' | 'unknown';
export type ValidatedFaceCapability =
  | 'available'
  | 'missing'
  | 'corrupt'
  | 'unsupported'
  | 'unknown';
export type MainThreadCapability = 'ready' | 'pending' | 'unavailable';
export type WorkerCapability = 'adopted' | 'pending' | 'unavailable';
export type ShapingCapability = 'supported' | 'fallback' | 'unsupported';
export type ExportCapability = 'supported' | 'restricted' | 'unavailable' | 'unknown';
export type NetworkCapability = 'online' | 'offline' | 'unknown';
export type OperationPermission = 'allowed' | 'denied' | 'unknown';

export interface FontCapabilityState {
  catalog: CatalogCapability;
  storedBytes: StoredBytesCapability;
  validatedFace: ValidatedFaceCapability;
  mainThread: MainThreadCapability;
  worker: WorkerCapability;
  shaping: ShapingCapability;
  export: ExportCapability;
  network: NetworkCapability;
  permissions: {
    localAccess: OperationPermission;
    embedding: OperationPermission;
    redistribution: OperationPermission;
  };
}

export type FontCapabilityOutcome =
  | 'ready'
  | 'loading'
  | 'missing-family'
  | 'missing-face'
  | 'corrupt'
  | 'unsupported'
  | 'permission-denied'
  | 'offline'
  | 'restricted'
  | 'error';

export type FontCapabilityAction =
  | 'install-family'
  | 'install-face'
  | 'repair-file'
  | 'choose-compatible'
  | 'allow-local-fonts'
  | 'retry-online'
  | 'outline-or-rasterize'
  | 'wait-for-load'
  | 'use-main-thread'
  | 'none';

export interface FontCapabilityDiagnostic {
  outcome: FontCapabilityOutcome;
  reason: string;
  nextAction: FontCapabilityAction;
}

/**
 * Evaluate a capability projection in priority order.
 *
 * The order is intentional: a corrupt or unsupported artifact must not be
 * reported as merely offline, and an exact missing face must not be hidden by
 * a family-level catalog match. `ready` means the main thread can render;
 * worker adoption is an optimization and is therefore not required here.
 */
export function diagnoseFontCapabilities(
  capabilities: FontCapabilityState,
): FontCapabilityDiagnostic {
  if (capabilities.catalog === 'missing') {
    return {
      outcome: 'missing-family',
      reason: 'No catalog entry is available for this font family.',
      nextAction: 'install-family',
    };
  }
  if (capabilities.validatedFace === 'missing') {
    return {
      outcome: 'missing-face',
      reason: 'The family is known, but the requested face is not available.',
      nextAction: 'install-face',
    };
  }
  if (capabilities.storedBytes === 'corrupt' || capabilities.validatedFace === 'corrupt') {
    return {
      outcome: 'corrupt',
      reason: 'The stored font bytes failed integrity or face validation.',
      nextAction: 'repair-file',
    };
  }
  if (capabilities.validatedFace === 'unsupported' || capabilities.shaping === 'unsupported') {
    return {
      outcome: 'unsupported',
      reason: 'This runtime cannot validate or shape the requested face.',
      nextAction: 'choose-compatible',
    };
  }
  if (capabilities.permissions.localAccess === 'denied') {
    return {
      outcome: 'permission-denied',
      reason: 'Local font access was denied by the browser or operating system.',
      nextAction: 'allow-local-fonts',
    };
  }
  if (
    capabilities.network === 'offline' &&
    capabilities.storedBytes === 'missing' &&
    capabilities.validatedFace !== 'available'
  ) {
    return {
      outcome: 'offline',
      reason: 'The exact font is not stored locally and the network is unavailable.',
      nextAction: 'retry-online',
    };
  }
  if (capabilities.export === 'restricted' || capabilities.permissions.embedding === 'denied') {
    return {
      outcome: 'restricted',
      reason: 'The font may render locally but its embedding permission is restricted.',
      nextAction: 'outline-or-rasterize',
    };
  }
  if (capabilities.mainThread === 'pending' || capabilities.worker === 'pending') {
    return {
      outcome: 'loading',
      reason: 'The exact face is still being loaded or adopted by the renderer.',
      nextAction: 'wait-for-load',
    };
  }
  if (capabilities.mainThread === 'unavailable') {
    return {
      outcome: 'error',
      reason: 'No renderer is ready to draw the exact face.',
      nextAction: 'use-main-thread',
    };
  }
  return {
    outcome: 'ready',
    reason: 'The exact face is available for main-thread rendering.',
    nextAction: 'none',
  };
}

/** A conservative projection for metadata that has not reached runtime yet. */
export function unknownFontCapabilities(): FontCapabilityState {
  return {
    catalog: 'present',
    storedBytes: 'unknown',
    validatedFace: 'unknown',
    mainThread: 'unavailable',
    worker: 'unavailable',
    shaping: 'fallback',
    export: 'unknown',
    network: 'unknown',
    permissions: {
      localAccess: 'unknown',
      embedding: 'unknown',
      redistribution: 'unknown',
    },
  };
}

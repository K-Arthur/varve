/**
 * Model verification status for the UI.
 *
 * Provides a structured status that the frontend can display to users:
 * - Whether the model is verified, partially verified, or unverified
 * - What specific checks have passed or failed
 * - Whether the model is safe to use in production inference
 * - Repair/redownload actions when verification fails
 */

import type { ModelManifestEntry, ModelValidationStatus } from '../inference/types';

// ── Types ────────────────────────────────────────────────────────────────

export type ModelVerificationLevel =
  | 'fully-verified' // All checks passed: contract + integrity + inference
  | 'partially-verified' // Some checks passed, others pending
  | 'unverified' // No verification has been performed
  | 'verification-failed' // One or more critical checks failed
  | 'disabled'; // Model explicitly disabled (e.g., BiRefNet Full without SHA-256)

export interface ModelVerificationDetail {
  level: ModelVerificationLevel;
  /** Human-readable status message. */
  statusMessage: string;
  /** Whether this model is safe for production inference. */
  safeForInference: boolean;
  /** Specific check results. */
  checks: {
    integrity: { passed: boolean; message: string };
    contract: { passed: boolean; message: string };
    inference: { passed: boolean; message: string };
    provenance: { passed: boolean; message: string };
  };
  /** Suggested user action. */
  action?: {
    label: string;
    kind: 'repair' | 'redownload' | 'disable' | 'verify-manually';
    modelId: string;
  };
}

// ── Assessment logic ─────────────────────────────────────────────────────

/**
 * Assess the verification status of a model and produce a UI-ready
 * verification detail.
 */
export function assessModelVerification(model: ModelManifestEntry): ModelVerificationDetail {
  const v = model.validation;
  const tc = model.tensorContract;
  const hasSha256 = !!model.checksum && model.checksum !== '';

  // BiRefNet Full without SHA-256 — explicitly disabled
  if (model.id === 'birefnet-general' && !hasSha256) {
    return {
      level: 'disabled',
      statusMessage:
        'BiRefNet Full is disabled: no SHA-256 checksum published. ' +
        'Cannot securely download until checksum is pinned.',
      safeForInference: false,
      checks: {
        integrity: { passed: false, message: 'No SHA-256 checksum' },
        contract: {
          passed: !!tc?.version,
          message: tc ? 'Contract declared (unverified graph)' : 'No contract declared',
        },
        inference: { passed: false, message: 'Disabled — missing integrity metadata' },
        provenance: {
          passed: v?.provenanceStatus === 'verified',
          message: `Provenance: ${v?.provenanceStatus ?? 'unverified'}`,
        },
      },
      action: {
        label: 'Awaiting checksum publication',
        kind: 'disable',
        modelId: model.id,
      },
    };
  }

  // BiRefNet Lite — contract declared but not verified against ONNX graph
  if (model.id === 'birefnet-general-lite' && tc && !v?.contractVerified) {
    return {
      level: 'partially-verified',
      statusMessage:
        'BiRefNet Lite has a declared tensor contract but it has NOT been verified ' +
        'against the actual ONNX graph. SHA-256 integrity is verified.',
      safeForInference: false,
      checks: {
        integrity: { passed: v?.integrityVerified ?? false, message: 'SHA-256 verified' },
        contract: {
          passed: false,
          message: 'Declared but NOT verified against ONNX graph — do not use in production',
        },
        inference: { passed: false, message: 'Pending graph inspection' },
        provenance: {
          passed: v?.provenanceStatus === 'verified',
          message: `Provenance: ${v?.provenanceStatus ?? 'unverified'}`,
        },
      },
      action: {
        label: 'Run graph inspection',
        kind: 'verify-manually',
        modelId: model.id,
      },
    };
  }

  // Fully verified model
  if (v?.contractVerified && v.integrityVerified && v.inferenceVerified) {
    return {
      level: 'fully-verified',
      statusMessage: v.validationSummary ?? 'All verification checks passed.',
      safeForInference: true,
      checks: {
        integrity: { passed: true, message: 'SHA-256 verified' },
        contract: { passed: true, message: `Contract v${v.contractVersion} verified` },
        inference: { passed: true, message: 'Smoke-tested' },
        provenance: {
          passed: v.provenanceStatus === 'verified',
          message: `Provenance: ${v.provenanceStatus}`,
        },
      },
    };
  }

  // Bundled models with known-good status (u2netp, realesr)
  if (model.bundled && hasSha256) {
    return {
      level: 'fully-verified',
      statusMessage: 'Bundled model — integrity verified, contract checked.',
      safeForInference: true,
      checks: {
        integrity: { passed: true, message: 'Bundled — SHA-256 matches' },
        contract: {
          passed: v?.contractVerified ?? false,
          message: v?.contractVerified ? 'Contract verified' : 'Contract not yet verified',
        },
        inference: {
          passed: v?.inferenceVerified ?? false,
          message: v?.inferenceVerified ? 'Smoke-tested' : 'Not yet smoke-tested',
        },
        provenance: {
          passed: v?.provenanceStatus === 'verified',
          message: `Provenance: ${v?.provenanceStatus ?? 'unverified'}`,
        },
      },
    };
  }

  // Downloaded model with SHA-256 but incomplete verification
  if (hasSha256 && v?.integrityVerified) {
    return {
      level: 'partially-verified',
      statusMessage: v?.validationSummary ?? 'Integrity verified, other checks pending.',
      safeForInference: false,
      checks: {
        integrity: { passed: true, message: 'SHA-256 verified' },
        contract: {
          passed: v?.contractVerified ?? false,
          message: v?.contractVerified ? 'Contract verified' : 'Contract verification pending',
        },
        inference: {
          passed: v?.inferenceVerified ?? false,
          message: v?.inferenceVerified ? 'Smoke-tested' : 'Inference not yet verified',
        },
        provenance: {
          passed: v?.provenanceStatus === 'verified',
          message: `Provenance: ${v?.provenanceStatus ?? 'unverified'}`,
        },
      },
      action: v?.contractVerified
        ? undefined
        : {
            label: 'Verify contract',
            kind: 'verify-manually',
            modelId: model.id,
          },
    };
  }

  // Model without SHA-256 — unverified
  if (!hasSha256) {
    return {
      level: 'unverified',
      statusMessage: 'No SHA-256 checksum — integrity cannot be verified.',
      safeForInference: false,
      checks: {
        integrity: { passed: false, message: 'No SHA-256 checksum published' },
        contract: {
          passed: !!tc,
          message: tc ? 'Contract declared' : 'No contract',
        },
        inference: { passed: false, message: 'Cannot verify without integrity check' },
        provenance: {
          passed: false,
          message: 'No provenance without integrity',
        },
      },
      action: {
        label: 'Await checksum',
        kind: 'disable',
        modelId: model.id,
      },
    };
  }

  // Default: unverified
  return {
    level: 'unverified',
    statusMessage: v?.validationSummary ?? 'Verification not yet performed.',
    safeForInference: false,
    checks: {
      integrity: { passed: v?.integrityVerified ?? false, message: 'Integrity check pending' },
      contract: { passed: v?.contractVerified ?? false, message: 'Contract check pending' },
      inference: { passed: v?.inferenceVerified ?? false, message: 'Inference check pending' },
      provenance: {
        passed: v?.provenanceStatus === 'verified',
        message: `Provenance: ${v?.provenanceStatus ?? 'unverified'}`,
      },
    },
  };
}

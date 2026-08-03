/**
 * Document proof configuration (persisted document state).
 *
 * Soft proofing simulates an output condition for display. The CONFIG
 * (profile, intent, simulation flags, gamut-warning preferences) is part of
 * the document's print intent and travels with the document. The proof
 * TOGGLE (on/off right now) is workspace/session state and is deliberately
 * NOT persisted here — it lives in the editor context.
 *
 * Proof state never mutates document colors. Export remains authoritative
 * for final ICC conversion.
 */

import type { ProofRenderingIntent } from '@strata/shared';
import type { Document } from './document';

export interface ProofGamutWarningConfig {
  /** Show out-of-proof-gamut warnings on canvas and picker. */
  enabled: boolean;
  /** Warning overlay opacity (0-1). */
  opacity: number;
}

/** Persisted proof configuration for a document. */
export interface ProofConfig {
  /** Proof profile identifier (e.g. 'fogra39'). */
  profileId: string;
  /** Proof profile display name (denormalized for UI). */
  profileName?: string;
  renderingIntent: ProofRenderingIntent;
  blackPointCompensation: boolean;
  simulatePaperColor: boolean;
  simulateBlackInk: boolean;
  gamutWarning: ProofGamutWarningConfig;
}

export function defaultProofConfig(): ProofConfig {
  return {
    profileId: 'fogra39',
    profileName: 'Fogra39 (ISO Coated v2 300%)',
    renderingIntent: 'relative',
    blackPointCompensation: true,
    simulatePaperColor: false,
    simulateBlackInk: false,
    gamutWarning: { enabled: false, opacity: 0.4 },
  };
}

/** Replace the document proof configuration (never touches colors). */
export function setDocumentProofConfig(doc: Document, config: ProofConfig): Document {
  return { ...doc, proofConfig: config };
}

/** Validate a persisted proof config, returning issue strings. */
export function validateProofConfig(config: ProofConfig): string[] {
  const issues: string[] = [];
  if (!config.profileId) issues.push('proof profile id is required');
  if (
    config.renderingIntent !== 'perceptual' &&
    config.renderingIntent !== 'relative' &&
    config.renderingIntent !== 'absolute' &&
    config.renderingIntent !== 'saturation'
  ) {
    issues.push('invalid proof rendering intent');
  }
  const opacity = config.gamutWarning.opacity;
  if (Number.isNaN(opacity) || opacity < 0 || opacity > 1) {
    issues.push('gamut warning opacity must be in [0, 1]');
  }
  return issues;
}

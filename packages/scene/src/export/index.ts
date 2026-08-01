/**
 * Canonical export infrastructure (Strata export rebuild).
 *
 * Single source of truth for export intent, capability contracts, plan
 * normalization, naming, and preflight. UI, commands, persistence, workers,
 * native encoders, and tests all build from these modules.
 */

export * from './adapter';
export * from './model';

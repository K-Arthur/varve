/**
 * Lightweight feature gating.
 *
 * Extends EditorSettings.features with typed accessors, test overrides,
 * and runtime capability gates. Flags are persisted in localStorage via
 * EditorSettings, so user opt-in survives sessions.
 */

import { getPlatformInfo, type PlatformCapability } from '@strata/platform';
import { DEFAULT_FEATURES, loadSettings } from './settings';

export type FeatureFlag =
  | 'findingsNavigation'
  | 'findingsOverlay'
  | 'codegenWorkspace'
  | 'aiFeatures'
  | 'reducedMotion';

const FEATURE_DESCRIPTIONS: Record<
  FeatureFlag,
  {
    label: string;
    description: string;
    experimental?: boolean;
    devOnly?: boolean;
    requiresCapability?: PlatformCapability;
  }
> = {
  findingsNavigation: {
    label: 'Finding Navigation',
    description: 'Navigate to findings via deep links and inspector sections.',
  },
  findingsOverlay: {
    label: 'Audit Overlay',
    description: 'Show audit findings as overlays on the canvas.',
    experimental: true,
  },
  codegenWorkspace: {
    label: 'Codegen Workspace',
    description: 'Enable the Codegen & Audit workspace mode.',
  },
  aiFeatures: {
    label: 'AI Features',
    description: 'Enable background removal, upscaling, and other AI features.',
    requiresCapability: 'wasm',
  },
  reducedMotion: {
    label: 'Reduced Motion',
    description: 'Reduce animation motion for accessibility.',
  },
};

let _overrides: Partial<Record<FeatureFlag, boolean>> | null = null;

/** Override feature flags for tests. */
export function setFeatureOverrides(overrides: Partial<Record<FeatureFlag, boolean>> | null): void {
  _overrides = overrides;
}

/** Check if a feature is enabled. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (_overrides && flag in _overrides) {
    return _overrides[flag]!;
  }

  const settings = loadSettings();
  const value = (settings.features as Record<string, boolean>)?.[flag];
  if (value !== undefined) return value;

  return (DEFAULT_FEATURES as Record<string, boolean>)?.[flag] ?? false;
}

/** Get all feature flags with their current state. */
export function getAllFeatures(): Array<{
  flag: FeatureFlag;
  enabled: boolean;
  experimental: boolean;
  devOnly: boolean;
  label: string;
  description: string;
}> {
  const flags: FeatureFlag[] = [
    'findingsNavigation',
    'findingsOverlay',
    'codegenWorkspace',
    'aiFeatures',
    'reducedMotion',
  ];
  return flags.map((flag) => ({
    flag,
    enabled: isFeatureEnabled(flag),
    experimental: FEATURE_DESCRIPTIONS[flag].experimental ?? false,
    devOnly: FEATURE_DESCRIPTIONS[flag].devOnly ?? false,
    label: FEATURE_DESCRIPTIONS[flag].label,
    description: FEATURE_DESCRIPTIONS[flag].description,
  }));
}

/** Check if a feature is gated by a runtime capability. */
export function isFeatureAvailable(flag: FeatureFlag): boolean {
  const requires = FEATURE_DESCRIPTIONS[flag].requiresCapability;
  if (!requires) return true;
  return getPlatformInfo().capabilities.has(requires);
}

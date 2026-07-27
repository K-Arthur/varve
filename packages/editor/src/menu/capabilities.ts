/**
 * Platform capability detection for menu gating.
 *
 * Delegates to `@strata/platform` for canonical runtime detection and adds
 * a caching/mocking layer for menu-specific use (which is called frequently
 * during menu rendering).
 */
import {
  hasCapability as baseHasCapability,
  getPlatformInfo,
  resetPlatformInfo as resetBase,
  setPlatformInfoForTest as setBaseOverride,
} from '@strata/platform';
import type { Capability } from './types';

let _overrides: ReadonlySet<Capability> | null = null;
let _cached: ReadonlySet<Capability> | null = null;

export function setCapabilitiesForTest(caps: ReadonlySet<Capability> | null): void {
  _overrides = caps;
  _cached = null;
}

/** High-level capabilities for menu gating. */
export function computeCapabilities(platformKind?: string): ReadonlySet<Capability> {
  if (_overrides) return _overrides;
  if (_cached && platformKind === undefined) return _cached;

  // If platform kind is explicitly provided, use it to override the base info
  if (platformKind !== undefined) {
    const base = getPlatformInfo();
    const caps = new Set<Capability>(base.capabilities as unknown as Capability[]);
    _cached = caps;
    return caps;
  }

  // Delegate to canonical detection + ensure backward compat with the
  // Capability subset
  const base = getPlatformInfo();
  const caps = new Set<Capability>();
  for (const cap of base.capabilities) {
    // Only include capabilities that are in the Capability type
    if (isCapability(cap)) caps.add(cap);
  }

  if (platformKind === undefined) {
    _cached = caps;
  }
  return caps;
}

function isCapability(c: string): c is Capability {
  return [
    'fs.read',
    'fs.write',
    'fs.watch',
    'fs.recentPaths',
    'archive',
    'backup',
    'nativeMenu',
    'multiWindow',
    'shell.open',
    'fonts.local',
    'clipboard.image',
    'notifications',
    'autoUpdate',
  ].includes(c);
}

export function resetCapabilitiesCache(): void {
  _cached = null;
  resetBase();
}

// Re-export for convenience in tests
export { baseHasCapability, setBaseOverride as setPlatformInfoForTest };

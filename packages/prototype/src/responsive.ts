/**
 * Responsive and adaptive prototyping system — breakpoint management and
 * device simulation for previewing prototypes at different screen sizes.
 *
 * Research basis: Figma device frames and breakpoint presets, Framer
 * responsive preview, CSS Media Queries (min-width/max-width), WCAG
 * 1.4.10 Reflow (content at 400% zoom).
 */

import type { BreakpointConfig, DeviceConfig } from './types';

/**
 * Create a breakpoint configuration.
 */
export function createBreakpointConfig(
  name: string,
  minWidth: number,
  maxWidth: number,
  device?: DeviceConfig,
): BreakpointConfig {
  return { name, minWidth, maxWidth, device };
}

/**
 * Find the active breakpoint for a given viewport width.
 * Returns the first matching breakpoint (in order of definition).
 * Returns null if no breakpoints are configured or none match.
 */
export function findActiveBreakpoint(
  breakpoints: BreakpointConfig[],
  viewportWidth: number,
): BreakpointConfig | null {
  for (const bp of breakpoints) {
    if (viewportWidth >= bp.minWidth && viewportWidth <= bp.maxWidth) {
      return bp;
    }
  }
  return null;
}

/**
 * Get the device configuration for a given viewport width.
 * Returns null if no breakpoints or no device configured.
 */
export function getDeviceForViewport(
  breakpoints: BreakpointConfig[],
  viewportWidth: number,
): DeviceConfig | null {
  const bp = findActiveBreakpoint(breakpoints, viewportWidth);
  return bp?.device ?? null;
}

/**
 * Sort breakpoints by minWidth ascending.
 */
export function sortBreakpoints(breakpoints: BreakpointConfig[]): BreakpointConfig[] {
  return [...breakpoints].sort((a, b) => a.minWidth - b.minWidth);
}

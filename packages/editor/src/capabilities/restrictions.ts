/**
 * Deployment capability restrictions.
 *
 * Some deployments of this editor cannot honestly offer every capability the
 * desktop app does. The public browser demo is the current case: on-device
 * inference would mean a 25 MB runtime download and a heavy in-tab compute
 * job, print production has no printers to talk to, and several specialist
 * workspaces either depend on those two or need a frame budget a browser tab
 * cannot hold.
 *
 * Rather than scatter `if (isDemo)` through the editor, the host application
 * declares its restrictions once at boot and every affected surface asks here.
 * The default is "nothing restricted", so the desktop app and the ordinary web
 * build are untouched.
 *
 * This module is deliberately a leaf: it knows what is restricted and what to
 * tell the user, never *why* the host decided that. It holds no React state —
 * restrictions are fixed for the lifetime of the page, so a module-level value
 * read during render is correct and avoids threading a provider through every
 * consumer.
 */

import type { WorkspaceMode } from '@varve/shared';

/** Capabilities a deployment can withhold. */
export type RestrictedCapability =
  /** On-device inference: background removal, image upscaling, semantic search. */
  | 'inference'
  /** Print production output: PDF export, CMYK, bleed, colour-managed print. */
  | 'printProduction';

export interface CapabilityRestrictions {
  /** Capabilities this deployment does not offer. */
  readonly restricted: ReadonlySet<RestrictedCapability>;
  /** Workspace modes this deployment exposes; null means every mode. */
  readonly workspaceModes: readonly WorkspaceMode[] | null;
  /**
   * Where a restricted surface should send the user, if anywhere. Absent on
   * unrestricted deployments — there is nothing to upsell.
   */
  readonly upgradeUrl?: string;
}

const NONE: CapabilityRestrictions = {
  restricted: new Set(),
  workspaceModes: null,
};

let current: CapabilityRestrictions = NONE;

/**
 * Declare this deployment's restrictions. Call once, before the editor mounts.
 * Passing null restores the unrestricted default (used by tests).
 */
export function setCapabilityRestrictions(next: CapabilityRestrictions | null): void {
  current = next ?? NONE;
}

export function getCapabilityRestrictions(): CapabilityRestrictions {
  return current;
}

export function isCapabilityRestricted(capability: RestrictedCapability): boolean {
  return current.restricted.has(capability);
}

/**
 * Filter a list of workspace modes down to the ones this deployment exposes,
 * preserving the caller's order. Unrestricted deployments get the list back
 * untouched.
 */
export function allowedWorkspaceModes<T extends WorkspaceMode>(modes: readonly T[]): readonly T[] {
  const allowed = current.workspaceModes;
  if (!allowed) return modes;
  const set = new Set<WorkspaceMode>(allowed);
  return modes.filter((mode) => set.has(mode));
}

export function isWorkspaceModeAllowed(mode: WorkspaceMode): boolean {
  const allowed = current.workspaceModes;
  return !allowed || allowed.includes(mode);
}

/** User-facing copy for a restricted capability. Kept here so every surface says the same thing. */
export const RESTRICTION_MESSAGES: Record<RestrictedCapability, string> = {
  inference:
    'Background removal, upscaling, and visual search run on-device in the desktop app. They are not available in the browser demo.',
  printProduction:
    'PDF export, CMYK, bleed, and colour-managed print output are desktop-only. The browser has no print pipeline to hand them to.',
};

/**
 * Export formats withheld by the `printProduction` restriction.
 *
 * These are the print pipeline's outputs: a screen PDF still goes through the
 * PDF writer, and PDF/X-1a and PDF/X-4 additionally carry CMYK conversion,
 * bleed, and an output intent. A browser has nothing to hand them to, so the
 * demo offers the raster and vector formats instead — a visitor can still take
 * their work out as PNG, JPEG, WebP, or SVG.
 */
const PRINT_PRODUCTION_FORMATS: ReadonlySet<string> = new Set(['pdf-screen', 'pdf-x1a', 'pdf-x4']);

export function isExportFormatRestricted(format: string): boolean {
  return isCapabilityRestricted('printProduction') && PRINT_PRODUCTION_FORMATS.has(format);
}

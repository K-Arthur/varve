/**
 * Built-in icon provider bootstrap.
 *
 * `ensureIconProviders()` registers the built-in providers with the global
 * registry exactly once (idempotent, import-order safe, hot-reload safe).
 * Call it before the first search — from app bootstrap and defensively from
 * the Icons surface mount.
 */

import { createIconifyProvider } from './iconifyProvider';
import { getIconProviderRegistry } from './iconProviders';

/** Register all built-in providers. Idempotent; safe to call repeatedly. */
export function ensureIconProviders(): void {
  const registry = getIconProviderRegistry();
  registry.ensureProviders(() => {
    registry.register(createIconifyProvider());
  });
}

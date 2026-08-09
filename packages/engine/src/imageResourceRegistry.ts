/**
 * Image resource registry — canonical render-time identity for raster
 * resources.
 *
 * Scene documents reference embedded images by content-addressed
 * `assetId` (e.g. `asset-<hash>`); the render IR carries that same short,
 * stable handle as the image fill's `src` instead of a multi-megabyte base64
 * data URL. The registry maps a handle to the loadable source string
 * (currently the asset's data URL) so replay, worker bitmap collection, and
 * export preflight can resolve the handle to a cache key without ever
 * moving the payload through the IR.
 *
 * Requirements this satisfies (raster resource architecture):
 * - handles are deterministic, short, non-sensitive, stable for the
 *   document session, collision-resistant (content-addressed), usable as
 *   cache keys, and portable across main/worker boundaries;
 * - legacy fills without an `assetId` keep their raw `src` (data URL,
 *   blob:, http(s), or proxy URL) and never touch the registry;
 * - registration is idempotent: the same handle always maps to the same
 *   source, so re-registering per frame or after document switches is free;
 * - no hashing happens on the render path; content hashing occurred at
 *   ingestion (scene `hashContent`).
 */

/** Map handle -> loadable source string. */
const registry = new Map<string, string>();

/**
 * Register (or confirm) the source for a canonical resource handle.
 * Idempotent; re-registering the same handle with the same source is a
 * no-op. Returns the handle for chaining.
 */
export function registerImageResourceHandle(handle: string, source: string): string {
  if (typeof handle !== 'string' || handle.length === 0) return handle;
  const existing = registry.get(handle);
  if (existing !== source) {
    // Content-addressed handles are stable by construction; a conflicting
    // mapping would indicate a document-model bug, so the latest wins and
    // the source of truth is the document asset table.
    registry.set(handle, source);
  }
  return handle;
}

/** True when `value` is a registered resource handle. */
export function isImageResourceHandle(value: string): boolean {
  return registry.has(value);
}

/**
 * Resolve a render-time image identity to its loadable source. Handles
 * resolve through the registry; legacy raw sources pass through unchanged.
 */
export function resolveImageResourceHandle(value: string): string {
  return registry.get(value) ?? value;
}

/** Deregister a handle (document close / test isolation). */
export function unregisterImageResourceHandle(handle: string): void {
  registry.delete(handle);
}

/** Total registered handles (diagnostics). */
export function imageResourceRegistrySize(): number {
  return registry.size;
}

/** Clear the registry (tests, full reset). */
export function resetImageResourceRegistry(): void {
  registry.clear();
}

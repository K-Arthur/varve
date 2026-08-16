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
import type { RenderItem } from './types';

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

/**
 * Retain only handles belonging to the active render session. Handles from a
 * closed document are derived data and must not pin multi-megabyte data URLs
 * for the lifetime of the application. A later document render can register
 * its handles again before building IR.
 */
export function retainImageResourceHandles(handles: Iterable<string>): number {
  const retained = new Set(handles);
  let removed = 0;
  for (const handle of registry.keys()) {
    if (retained.has(handle)) continue;
    registry.delete(handle);
    removed++;
  }
  return removed;
}

/** Total registered handles (diagnostics). */
export function imageResourceRegistrySize(): number {
  return registry.size;
}

/** Clear the registry (tests, full reset). */
export function resetImageResourceRegistry(): void {
  registry.clear();
}

/** A render item that may carry a compiled table primitive. */
export type TableCarryingItem = {
  primitive?: { kind?: string; cells?: Array<{ content?: RenderItem }> } | null;
  shape?: { kind?: string; cells?: Array<{ content?: RenderItem }> } | null;
};

const MAX_TABLE_CONTENT_DEPTH = 8;

function tableCellsOf(item: TableCarryingItem): Array<{ content?: RenderItem }> | undefined {
  if (item.primitive?.kind === 'table' && item.primitive.cells) {
    return item.primitive.cells;
  }
  if (item.shape?.kind === 'table' && item.shape.cells) {
    return item.shape.cells;
  }
  return undefined;
}

/**
 * Visit every rich scene-content item compiled into a table's cells
 * (nested tables included, depth-capped against pathological documents).
 *
 * Table cell content is compiled into the render IR at flatten time
 * (images, components, groups inside cells), so resource collection for
 * worker transport and export preflight must walk it — a collector that
 * only inspects top-level `fills` silently drops cell images, and a worker
 * frame would replay them as gray placeholders that never recover.
 * Flattened nodes carry the table under `shape`; built IR under
 * `primitive` — both are walked.
 */
export function walkTableCellContents(
  item: TableCarryingItem,
  visit: (content: RenderItem) => void,
): void {
  const cells = tableCellsOf(item);
  if (!cells || cells.length === 0) return;
  const stack: RenderItem[] = [];
  for (const cell of cells) {
    if (cell.content) stack.push(cell.content);
  }
  let depth = 0;
  while (stack.length > 0 && depth < MAX_TABLE_CONTENT_DEPTH) {
    const content = stack.pop() as RenderItem;
    visit(content);
    const nested = tableCellsOf(content as TableCarryingItem);
    if (nested) {
      for (const cell of nested) {
        if (cell.content) stack.push(cell.content);
      }
    }
    depth += 1;
  }
}

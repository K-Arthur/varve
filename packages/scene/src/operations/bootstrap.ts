/**
 * Operation pipeline bootstrap (ADR-0017/0018).
 *
 * Importing this module registers every operation family in the registry.
 * The editor and future history package dispatch through the registry —
 * never by mutating the document directly.
 */

import { registerDocumentAssetOperations } from './ops/documentAssetOps';
import { registerNodeOperations } from './ops/nodeOps';
import { registerPageOperations } from './ops/pageOps';

let registered = false;

/** Register all built-in operation families exactly once (idempotent). */
export function registerBuiltinOperations(): void {
  if (registered) return;
  registerNodeOperations();
  registerDocumentAssetOperations();
  registerPageOperations();
  registered = true;
}

/**
 * Panel registry bootstrap.
 *
 * Registers the built-in panel definitions once at module load. Imported
 * for side effect by the editor package entry (index.ts) so the registry
 * is populated before any panel component renders — the detach/drag UI
 * depends on `isPanelDetachable` being true at runtime.
 *
 * Tests that import source paths directly (not the package entry) are
 * unaffected: they call resetPanelRegistry + registerBuiltinPanels in
 * beforeEach as before.
 */

import { registerBuiltinPanels } from './panelDefinitions';

registerBuiltinPanels();

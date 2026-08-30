/**
 * Auxiliary window public API.
 *
 * Barrel for the minimal provider tree and shell used by panel-only
 * auxiliary windows. Does NOT import the full editor context.
 */

// An auxiliary page may be bundled independently from the primary entry.
// Populate the declarative panel registry in that case so transfer lifecycle
// restoration validates against the exact same definitions as the source.
import '../workspace/bootstrap';

export type {
  AuxiliarySessionContextValue,
  AuxiliarySessionProviderProps,
  AuxiliarySessionState,
} from './AuxiliaryProvider';
export { AuxiliarySessionProvider, useAuxiliarySession } from './AuxiliaryProvider';
export type { AuxiliaryRootProps, AuxiliaryWindowInfo } from './AuxiliaryShell';
export { AuxiliaryRoot, parseAuxiliaryWindowParams } from './AuxiliaryShell';
export { renderAuxiliaryPanel } from './panelContentRegistry';

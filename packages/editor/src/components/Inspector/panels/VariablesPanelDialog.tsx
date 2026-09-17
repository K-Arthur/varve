/**
 * VariablesPanelDialog — modal host for document-level design-system
 * management: the variable store editor and the DTCG token sync center.
 *
 * Both surfaces are document-scoped (no selection dependency) and were
 * historically embedded below the Layers tree, competing with hierarchy
 * navigation for vertical space. The dialog is opened by the
 * `openVariablesPanel` action (View menu → Variables and Tokens…) via
 * variablesPanelVisible state.
 */

import { Dialog } from '@varve/ui';
import { VariablePanel } from '../../../VariablePanel';
import { TokenSyncPanel } from '../../TokenSync/TokenSyncPanel';

export interface VariablesPanelDialogProps {
  open: boolean;
  onClose: () => void;
}

export function VariablesPanelDialog({ open, onClose }: VariablesPanelDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Variables and tokens" size="lg">
      <VariablePanel />
      <TokenSyncPanel />
    </Dialog>
  );
}

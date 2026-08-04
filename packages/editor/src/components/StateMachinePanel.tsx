/**
 * StateMachinePanel — dedicated dialog host for StateMachineSection.
 *
 * State machines are document-wide (keyed off `document.stateMachines`, not
 * the current selection), so — like the Timeline — they get their own opt-in
 * surface rather than mounting unconditionally inside the per-selection
 * Properties inspector. Uses the shared `Dialog` primitive: native <dialog>,
 * focus trap, Escape/backdrop dismiss, and lazy content (children only render
 * while open).
 */
import { Dialog } from '@varve/ui';
import { ErrorBoundary } from './ErrorBoundary';
import { StateMachineSection } from './Inspector/sections/StateMachineSection';

export interface StateMachinePanelProps {
  open: boolean;
  onClose: () => void;
}

export function StateMachinePanel({ open, onClose }: StateMachinePanelProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="State Machine"
      dismissible
      className="state-machine-dialog"
    >
      <ErrorBoundary>
        <StateMachineSection />
      </ErrorBoundary>
    </Dialog>
  );
}

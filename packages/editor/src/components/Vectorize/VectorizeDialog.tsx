/**
 * VectorizeDialog — full vectorization workflow in a modal dialog.
 *
 * Hosted by the Inspector Image & Vector section so design/image workspaces
 * offer the same key features as the Logo panel (presets, source prep,
 * preview, diagnostics, single-undo apply). The dialog owns no document
 * state; the workflow inside it drives the same commands as every other
 * vectorization surface.
 */
import { Dialog } from '@strata/ui';
import { VectorizeWorkflow } from './VectorizeWorkflow';

export interface VectorizeDialogProps {
  open: boolean;
  onClose: () => void;
}

export function VectorizeDialog({ open, onClose }: VectorizeDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Vectorize image" dismissible>
      <VectorizeWorkflow emptyStateNote="Select an image layer to vectorize it. The result is inserted beside the source as editable paths." />
    </Dialog>
  );
}

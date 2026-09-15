/**
 * VectorizeDialog — full vectorization workflow in a modal dialog.
 *
 * Hosted by the Inspector Image & Vector section so design/image workspaces
 * offer the same key features as the Logo panel (presets, source prep,
 * preview, diagnostics, single-undo apply). The dialog owns no document
 * state; the workflow inside it drives the same commands as every other
 * vectorization surface.
 *
 * When opened with a re-trace prefill (`editor.openVectorizeDialog({...})`),
 * the workflow restores the stored trace metadata and Apply replaces the
 * original trace group in place.
 */
import { Dialog } from '@varve/ui';
import { useEditor } from '../../context';
import { settingsFromTraceMetadata } from '../../logo/vectorization/metadata';
import { VectorizeWorkflow } from './VectorizeWorkflow';

export interface VectorizeDialogProps {
  open: boolean;
  onClose: () => void;
}

export function VectorizeDialog({ open, onClose }: VectorizeDialogProps) {
  const { state } = useEditor();
  const prefill = state.vectorizeDialogPrefill;
  const replaceGroup = prefill ? state.document.nodes[prefill.replaceGroupId] : undefined;
  const traceMetadata = replaceGroup?.kind === 'group' ? replaceGroup.traceMetadata : undefined;
  const initialSettings = traceMetadata ? settingsFromTraceMetadata(traceMetadata) : null;
  return (
    <Dialog open={open} onClose={onClose} title="Vectorize image" dismissible focusFirstControl>
      <VectorizeWorkflow
        emptyStateNote="Select an image layer to vectorize it. The result is inserted beside the source as editable paths."
        initialSettings={initialSettings}
        replaceGroupId={prefill?.replaceGroupId ?? null}
      />
    </Dialog>
  );
}

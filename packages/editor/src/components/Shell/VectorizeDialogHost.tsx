/**
 * VectorizeDialogHost — mounts the Image Trace dialog from editor state.
 *
 * Follows the UpscaleDialogHost pattern: the dialog itself is controlled by
 * editor-level state (`vectorizeDialogOpen`) so every entry point — Object
 * menu, canvas context menu, layers context menu, command palette, and the
 * Inspector section — opens the same dialog without threading a local state
 * through each surface.
 */
import { useEditor } from '../../context';
import { VectorizeDialog } from '../Vectorize/VectorizeDialog';

export function VectorizeDialogHost() {
  const { state, closeVectorizeDialog } = useEditor();
  return <VectorizeDialog open={state.vectorizeDialogOpen} onClose={closeVectorizeDialog} />;
}

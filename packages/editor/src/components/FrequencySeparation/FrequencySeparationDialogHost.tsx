/**
 * FrequencySeparationDialogHost — mounts the dialog from editor state so the
 * hub Shell file needs no new import.
 */

import { useEditor } from '../../context';
import { FrequencySeparationDialog } from './FrequencySeparationDialog';

export function FrequencySeparationDialogHost() {
  const { state, closeFrequencySeparationDialog } = useEditor();
  return (
    <FrequencySeparationDialog
      open={state.frequencySeparationDialogOpen}
      targetNodeId={state.frequencySeparationTargetId}
      onClose={closeFrequencySeparationDialog}
    />
  );
}

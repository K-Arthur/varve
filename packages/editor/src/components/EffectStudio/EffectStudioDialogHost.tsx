/**
 * Primary-editor host for Effect Studio.
 *
 * The gallery is a controlled in-app dialog, like Settings and Image Enhance:
 * it reads the live editor context rather than transferring a document
 * projection to a second webview.
 */
import { Dialog, NestedOverlayProvider } from '@varve/ui';
import { useEditor } from '../../context';
import { EffectStudioPanel } from './EffectStudioPanel';

export function EffectStudioDialogHost() {
  const { effectStudioDialogOpen, closeEffectStudioDialog } = useEditor();

  return (
    <NestedOverlayProvider>
      <Dialog
        open={effectStudioDialogOpen}
        onClose={closeEffectStudioDialog}
        title="Effect Studio"
        dismissible
        size="lg"
        className="effect-studio-dialog"
        data-testid="effect-studio-dialog"
      >
        <EffectStudioPanel />
      </Dialog>
    </NestedOverlayProvider>
  );
}

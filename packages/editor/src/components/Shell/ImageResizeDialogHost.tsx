/** Mounts the source-pixel resize dialog from editor state. */
import { getImageFill } from '@varve/scene';
import { useEditor } from '../../context';
import { selectedImageShape } from '../../imageOperations';
import { ImageResizeDialog } from '../ImageResizeDialog';

export function ImageResizeDialogHost() {
  const editor = useEditor();
  if (!editor.imageResizeDialogOpen) return null;

  const imageNode = selectedImageShape(editor.state.document, editor.state.selection);
  const imageFill = imageNode ? getImageFill(imageNode) : undefined;
  if (!imageNode || imageFill?.type !== 'image' || !imageFill.image) return null;

  return (
    <ImageResizeDialog
      nodeId={imageNode.id}
      fill={imageFill.image}
      onClose={editor.closeImageResizeDialog}
      onApply={async (result) => {
        await editor.resizeSelectedImage(result);
        editor.closeImageResizeDialog();
      }}
    />
  );
}

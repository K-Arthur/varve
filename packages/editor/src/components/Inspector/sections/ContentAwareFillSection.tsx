import type { SceneNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { useEditor } from '../../../context';
import { restoreImageShapeContent } from '../../../imageOperations';
import { DisclosureSection } from '../controls/DisclosureSection';

interface ContentAwareFillSectionProps {
  nodes: SceneNode[];
  onOpenDialog?: (nodeId: string) => void;
}

export function ContentAwareFillSection({ nodes, onOpenDialog }: ContentAwareFillSectionProps) {
  const { state, updateDoc, beginTransaction, commitTransaction, abortTransaction, announce } =
    useEditor();
  const node = nodes[0];
  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  if (!isImage || !typedNode) return null;

  const imageWidth = typedNode.shape?.kind === 'rect' ? typedNode.shape.w : 0;
  const imageHeight = typedNode.shape?.kind === 'rect' ? typedNode.shape.h : 0;
  const acceptedEdit = typedNode.generativeEditId
    ? state.document.generativeEdits?.[typedNode.generativeEditId]
    : undefined;
  const sourceAssetId = acceptedEdit?.sourceSnapshotAssetId ?? acceptedEdit?.sourceAssetId;
  const sourceAsset = sourceAssetId ? state.document.assets?.[sourceAssetId] : undefined;

  const restoreOriginal = () => {
    if (!sourceAsset) return;
    beginTransaction();
    try {
      updateDoc((doc) =>
        restoreImageShapeContent(doc, typedNode.id, {
          sourceAsset,
          outputFrame: acceptedEdit?.mode === 'expand' ? acceptedEdit.outputFrame : undefined,
        }),
      );
      commitTransaction();
      announce('Restored the original image');
    } catch (error) {
      abortTransaction();
      announce(error instanceof Error ? error.message : 'Could not restore the original image');
    }
  };

  return (
    <DisclosureSection title="Generative Edit" sectionId="content-aware-fill">
      <div className="insp-field-group">
        <p className="insp-hint">
          Fill or remove selected pixels with local processing. The source layer stays editable.
        </p>
        {imageSrc && (
          <div className="caf-entry-thumb">
            <img
              src={imageSrc}
              alt="Source"
              className="caf-entry-thumb__img"
              style={{
                width: '100%',
                maxHeight: 80,
                objectFit: 'contain',
                borderRadius: 'var(--radius-control-compact)',
              }}
            />
            <span className="insp-hint">
              {imageWidth} {String.fromCharCode(215)} {imageHeight}
            </span>
          </div>
        )}
        <div className="insp-actions">
          <button
            type="button"
            className="caf-entry-button"
            onClick={() => onOpenDialog?.(node!.id)}
            aria-label="Open Generative Edit dialog"
          >
            Open Generative Edit
          </button>
          {sourceAsset && (
            <button
              type="button"
              className="caf-entry-button"
              onClick={restoreOriginal}
              aria-label="Restore original image"
            >
              Restore Original
            </button>
          )}
        </div>
      </div>
    </DisclosureSection>
  );
}

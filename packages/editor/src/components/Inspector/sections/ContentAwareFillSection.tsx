import type { SceneNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { useEditor } from '../../../context';
import { insertDerivedImageShape, restoreImageShapeContent } from '../../../imageOperations';
import { DisclosureSection } from '../controls/DisclosureSection';
import { BoundedImagePreview } from './ImageFillControls';

interface ContentAwareFillSectionProps {
  nodes: SceneNode[];
  onOpenDialog?: (nodeId: string) => void;
}

export function ContentAwareFillSection({ nodes, onOpenDialog }: ContentAwareFillSectionProps) {
  const {
    state,
    updateDoc,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    announce,
    setSelection,
  } = useEditor();
  const node = nodes[0];
  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';
  const imageFill = typedNode?.fills?.find((fill) => fill.type === 'image')?.image;
  const imageAsset = imageFill?.assetId ? state.document.assets?.[imageFill.assetId] : undefined;

  if (!isImage || !typedNode) return null;

  const imageWidth = typedNode.shape?.kind === 'rect' ? typedNode.shape.w : 0;
  const imageHeight = typedNode.shape?.kind === 'rect' ? typedNode.shape.h : 0;
  const acceptedEdit = typedNode.generativeEditId
    ? state.document.generativeEdits?.[typedNode.generativeEditId]
    : undefined;
  const sourceAssetId = acceptedEdit?.sourceSnapshotAssetId ?? acceptedEdit?.sourceAssetId;
  const sourceAsset = sourceAssetId ? state.document.assets?.[sourceAssetId] : undefined;
  const acceptedVariationId = acceptedEdit?.acceptedVariationId ?? acceptedEdit?.activeVariationId;
  const acceptedVariation = acceptedEdit?.variations.find(
    (variation) => variation.id === acceptedVariationId,
  );
  const resultAssetId =
    acceptedVariation?.assetId ??
    typedNode.fills?.find((fill) => fill.type === 'image')?.image?.assetId;
  const resultAsset = resultAssetId ? state.document.assets?.[resultAssetId] : undefined;

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

  const duplicateAsLayer = () => {
    if (!acceptedEdit || !resultAsset) {
      announce('The accepted generative result is no longer available to duplicate');
      return;
    }
    beginTransaction();
    try {
      const duplicateEditId = `${acceptedEdit.id}-copy-${Date.now()}`;
      const sourceImageFill = typedNode.fills?.find(
        (fill) => fill.type === 'image' && !fill.image?.generativeEditOverlay,
      );
      const boundedOverlay = typedNode.fills?.some(
        (fill) => fill.type === 'image' && Boolean(fill.image?.generativeEditOverlay),
      );
      const duplicateWidth =
        typedNode.shape.kind === 'rect' ? typedNode.shape.w : resultAsset.naturalWidth;
      const duplicateHeight =
        typedNode.shape.kind === 'rect' ? typedNode.shape.h : resultAsset.naturalHeight;
      const duplicated = insertDerivedImageShape(state.document, typedNode.id, {
        dataUrl: boundedOverlay
          ? (sourceImageFill?.image?.src ?? resultAsset.dataUrl)
          : resultAsset.dataUrl,
        assetId: boundedOverlay ? sourceImageFill?.image?.assetId : resultAsset.id,
        width: duplicateWidth,
        height: duplicateHeight,
        suffix: 'Generative Edit Copy',
        generativeEditId: duplicateEditId,
      });
      const duplicatedNode = duplicated.doc.nodes[duplicated.nodeId];
      const duplicateFills =
        boundedOverlay && duplicatedNode?.kind === 'shape'
          ? typedNode.fills?.map((fill) =>
              fill.type === 'image' && fill.image?.generativeEditOverlay
                ? {
                    ...fill,
                    image: {
                      ...fill.image,
                      src: resultAsset.dataUrl,
                      assetId: resultAsset.id,
                      generativeEditOverlay: {
                        editId: duplicateEditId,
                        variationId:
                          acceptedVariation?.id ?? fill.image.generativeEditOverlay.variationId,
                      },
                    },
                  }
                : fill,
            )
          : undefined;
      const duplicatedWithFills =
        duplicateFills && duplicatedNode?.kind === 'shape'
          ? {
              ...duplicated.doc,
              nodes: {
                ...duplicated.doc.nodes,
                [duplicated.nodeId]: { ...duplicatedNode, fills: duplicateFills },
              },
            }
          : duplicated.doc;
      // Candidate/source assets are immutable and can be shared, but the
      // record itself belongs to the new layer. Keeping a distinct record
      // prevents edits to the duplicate's recipe from changing the source's
      // provenance and gives clipboard/package traversal an unambiguous owner.
      const duplicateEdit = {
        ...acceptedEdit,
        id: duplicateEditId,
        sourceNodeId: duplicated.nodeId,
        resultNodeId: duplicated.nodeId,
        updatedAt: Date.now(),
      };
      updateDoc(() => ({
        ...duplicatedWithFills,
        generativeEdits: {
          ...duplicated.doc.generativeEdits,
          [duplicateEditId]: duplicateEdit,
        },
      }));
      commitTransaction();
      setSelection(duplicated.nodeId);
      announce('Duplicated the accepted generative result as a new layer');
    } catch (error) {
      abortTransaction();
      announce(error instanceof Error ? error.message : 'Could not duplicate the result');
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
            {((imageFill?.imageWidth ?? imageAsset?.naturalWidth ?? 0) > 1024 ||
              (imageFill?.imageHeight ?? imageAsset?.naturalHeight ?? 0) > 1024) &&
            (imageSrc.startsWith('data:') || imageSrc.startsWith('blob:')) ? (
              <BoundedImagePreview
                source={imageSrc}
                sourceWidth={imageFill?.imageWidth ?? imageAsset?.naturalWidth ?? 0}
                sourceHeight={imageFill?.imageHeight ?? imageAsset?.naturalHeight ?? 0}
                className="caf-entry-thumb__img"
              />
            ) : (
              <img
                src={imageSrc}
                alt="Source"
                className="caf-entry-thumb__img"
                decoding="async"
                style={{
                  width: '100%',
                  maxHeight: 80,
                  objectFit: 'contain',
                  borderRadius: 'var(--radius-control-compact)',
                }}
              />
            )}
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
          {acceptedEdit && resultAsset && (
            <button
              type="button"
              className="caf-entry-button"
              onClick={duplicateAsLayer}
              aria-label="Duplicate generative result as layer"
            >
              Duplicate as Layer
            </button>
          )}
        </div>
      </div>
    </DisclosureSection>
  );
}

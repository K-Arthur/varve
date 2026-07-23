import type { SceneNode } from '@strata/scene';
import { imageShapeSrc, isImageShape } from '@strata/scene';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

interface ContentAwareFillSectionProps {
  nodes: SceneNode[];
  onOpenDialog?: (nodeId: string) => void;
}

export function ContentAwareFillSection({ nodes, onOpenDialog }: ContentAwareFillSectionProps) {
  const { state } = useEditor();
  const node = nodes[0];
  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@strata/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  if (!isImage || !typedNode) return null;

  const imageWidth = typedNode.shape?.kind === 'rect' ? typedNode.shape.w : 0;
  const imageHeight = typedNode.shape?.kind === 'rect' ? typedNode.shape.h : 0;

  return (
    <DisclosureSection title="Content-Aware Fill" sectionId="content-aware-fill">
      <div className="insp-field-group">
        <p className="insp-hint">
          Remove unwanted objects or blemishes. Paint the area and let the AI fill it.
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
                borderRadius: 'var(--radius-sm)',
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
            onClick={() => onOpenDialog?.(node.id)}
            aria-label="Open Content-Aware Fill dialog"
          >
            Open Content-Aware Fill
          </button>
        </div>
      </div>
    </DisclosureSection>
  );
}

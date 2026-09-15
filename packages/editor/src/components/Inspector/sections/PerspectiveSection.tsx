/**
 * Inspector controls for an image fill's non-destructive four-corner
 * perspective transform.  The canvas tool remains the fast direct-manipulation
 * surface; this section provides precise numeric editing and reset/re-entry.
 */
import type { ImageFillPerspective, PerspectiveQuad, SceneNode, ShapeNode } from '@varve/scene';
import { getImageFill, isImageShape, isPerspectiveQuadValid } from '@varve/scene';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SectionId } from '../sectionRegistry';

interface PerspectiveSectionProps {
  nodes: SceneNode[];
  sectionId?: SectionId;
}

const CORNERS = [
  ['Top left', 0],
  ['Top right', 1],
  ['Bottom right', 2],
  ['Bottom left', 3],
] as const;

export function PerspectiveSection({ nodes, sectionId }: PerspectiveSectionProps) {
  const { updateDoc, setTool } = useEditor();
  const node = nodes[0];

  const image =
    node?.kind === 'shape' && isImageShape(node)
      ? getImageFill(node as ShapeNode)?.image
      : undefined;
  const perspective = image?.perspective;

  const updateQuad = useCallback(
    (quad: PerspectiveQuad) => {
      if (!node || !isPerspectiveQuadValid(quad)) return;
      updateDoc((doc) => {
        const current = doc.nodes[node.id];
        if (current?.kind !== 'shape') return doc;
        let changed = false;
        const fills = (current.fills ?? []).map((fill) => {
          if (changed || fill.type !== 'image' || !fill.image) return fill;
          changed = true;
          return {
            ...fill,
            image: {
              ...fill.image,
              perspective: { quad } satisfies ImageFillPerspective,
            },
          };
        });
        return changed
          ? { ...doc, nodes: { ...doc.nodes, [node.id]: { ...current, fills } } }
          : doc;
      });
    },
    [node, updateDoc],
  );

  const updateCorner = useCallback(
    (index: number, axis: 0 | 1, value: number) => {
      if (!perspective) return;
      const quad = perspective.quad.map((point, pointIndex) => {
        if (pointIndex !== index) return [point[0], point[1]] as [number, number];
        return axis === 0 ? [value, point[1]] : [point[0], value];
      }) as unknown as PerspectiveQuad;
      updateQuad(quad);
    },
    [perspective, updateQuad],
  );

  const reset = useCallback(() => {
    if (!node) return;
    updateDoc((doc) => {
      const current = doc.nodes[node.id];
      if (current?.kind !== 'shape') return doc;
      let changed = false;
      const fills = (current.fills ?? []).map((fill) => {
        if (changed || fill.type !== 'image' || !fill.image) return fill;
        changed = true;
        const { perspective: _perspective, ...imageData } = fill.image;
        return { ...fill, image: imageData };
      });
      return changed ? { ...doc, nodes: { ...doc.nodes, [node.id]: { ...current, fills } } } : doc;
    });
  }, [node, updateDoc]);

  if (!node || nodes.length !== 1 || !image) return null;

  return (
    <DisclosureSection
      title="Perspective"
      sectionId={sectionId}
      defaultExpanded={Boolean(perspective)}
    >
      <div className="insp-field-group">
        {!perspective ? (
          <>
            <p className="insp-hint">
              Distort this image with a source-preserving four-corner perspective transform.
            </p>
            <button type="button" className="insp-btn-sm" onClick={() => setTool('perspective')}>
              Edit Perspective
            </button>
          </>
        ) : (
          <>
            {CORNERS.map(([label, index]) => (
              <div className="insp-field" key={label}>
                <span className="insp-field__label" style={{ cursor: 'default' }}>
                  {label}
                </span>
                <div className="insp-field__control">
                  <NumberField
                    label={`${label} X`}
                    value={perspective.quad[index]![0]}
                    min={-100000}
                    max={100000}
                    step={1}
                    onChange={(value) => updateCorner(index, 0, value)}
                    unit="px"
                    displayLabel="X"
                  />
                  <NumberField
                    label={`${label} Y`}
                    value={perspective.quad[index]![1]}
                    min={-100000}
                    max={100000}
                    step={1}
                    onChange={(value) => updateCorner(index, 1, value)}
                    unit="px"
                    displayLabel="Y"
                  />
                </div>
              </div>
            ))}
            <div className="insp-image-placement__actions">
              <button type="button" className="insp-btn-sm" onClick={() => setTool('perspective')}>
                Edit on Canvas
              </button>
              <button type="button" className="insp-btn-sm" onClick={reset}>
                Reset Perspective
              </button>
            </div>
          </>
        )}
        {perspective && !isPerspectiveQuadValid(perspective.quad) && (
          <p className="insp-hint insp-hint--error" role="alert">
            Perspective corners must form a valid convex quadrilateral.
          </p>
        )}
        <FieldRow label="Source">
          <span className="insp-hint">Image pixels and crop remain editable.</span>
        </FieldRow>
      </div>
    </DisclosureSection>
  );
}

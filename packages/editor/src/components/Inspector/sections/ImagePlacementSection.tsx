/**
 * ImagePlacementSection — crop, scale, fit-to-frame, and reset controls
 * for shapes with image fills.
 *
 * Appears when a single ShapeNode with an image fill is selected.
 * Modifies the image fill's offset, scale, and fit mode in a single undo step.
 *
 * Research basis: Figma image fill controls, Sketch image cropping,
 * Adobe Illustrator clip group placement.
 */
import type { ImageFillData, ImageFit, SceneNode, ShapeNode } from '@strata/scene';
import { getImageFill, isImageShape } from '@strata/scene';
import { Icon } from '@strata/ui';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { SegmentedControl } from '../controls/SegmentedControl';

const FIT_OPTIONS: readonly { readonly value: ImageFit; readonly label: string }[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'tile', label: 'Tile' },
];

interface ImagePlacementSectionProps {
  nodes: SceneNode[];
}

export function ImagePlacementSection({ nodes }: ImagePlacementSectionProps) {
  const { updateDoc } = useEditor();
  const node = nodes[0];

  if (!node || nodes.length !== 1 || !isImageShape(node)) return null;
  const shapeNode = node as ShapeNode;
  const imageFill = getImageFill(shapeNode);
  if (!imageFill?.image) return null;
  const img = imageFill.image;

  const updateImage = useCallback(
    (patch: Partial<ImageFillData>) => {
      updateDoc((doc) => {
        const n = doc.nodes[node.id];
        if (n?.kind !== 'shape') return doc;
        const fills = (n.fills ?? []).map((f) => {
          if (f.type !== 'image' || !f.image) return f;
          return { ...f, image: { ...f.image, ...patch } };
        });
        return {
          ...doc,
          nodes: { ...doc.nodes, [node.id]: { ...n, fills } },
        };
      });
    },
    [node.id, updateDoc],
  );

  const handleFitChange = useCallback(
    (value: string) => updateImage({ fit: value as ImageFit }),
    [updateImage],
  );

  const handleOffsetX = useCallback((v: number) => updateImage({ x: v }), [updateImage]);

  const handleOffsetY = useCallback((v: number) => updateImage({ y: v }), [updateImage]);

  const handleScale = useCallback(
    (v: number) => updateImage({ scale: Math.max(0.01, v) }),
    [updateImage],
  );

  const resetPlacement = useCallback(() => {
    updateImage({ x: 0, y: 0, scale: 1, fit: 'fill' });
  }, [updateImage]);

  const fitToFrame = useCallback(() => {
    updateImage({ x: 0, y: 0, scale: 1, fit: 'fit' });
  }, [updateImage]);

  const fillFrame = useCallback(() => {
    updateImage({ x: 0, y: 0, scale: 1, fit: 'fill' });
  }, [updateImage]);

  const stretchToFrame = useCallback(() => {
    updateImage({ x: 0, y: 0, scale: 1, fit: 'stretch' });
  }, [updateImage]);

  return (
    <DisclosureSection title="Image Placement" defaultExpanded>
      <div className="insp-field-group">
        <FieldRow label="Fit">
          <SegmentedControl
            label="Image fit mode"
            options={FIT_OPTIONS}
            value={img.fit}
            onChange={handleFitChange}
          />
        </FieldRow>

        <FieldRow label="Scale">
          <NumberField
            label="Image scale"
            value={img.scale ?? 1}
            min={0.01}
            max={100}
            step={0.1}
            onChange={handleScale}
            unit="x"
          />
        </FieldRow>

        <FieldRow label="Offset X">
          <NumberField
            label="Image offset X"
            value={img.x ?? 0}
            step={1}
            onChange={handleOffsetX}
            unit="px"
          />
        </FieldRow>

        <FieldRow label="Offset Y">
          <NumberField
            label="Image offset Y"
            value={img.y ?? 0}
            step={1}
            onChange={handleOffsetY}
            unit="px"
          />
        </FieldRow>

        <div className="insp-field-row insp-image-placement__actions">
          <button
            type="button"
            className="insp-inline-btn"
            onClick={fitToFrame}
            title="Fit image to frame (contain)"
          >
            <Icon name="Maximize2" size="0.85em" />
            <span>Fit to frame</span>
          </button>
          <button
            type="button"
            className="insp-inline-btn"
            onClick={fillFrame}
            title="Fill frame (cover)"
          >
            <Icon name="Maximize" size="0.85em" />
            <span>Fill frame</span>
          </button>
          <button
            type="button"
            className="insp-inline-btn"
            onClick={stretchToFrame}
            title="Stretch to frame"
          >
            <Icon name="StretchHorizontal" size="0.85em" />
            <span>Stretch</span>
          </button>
          <button
            type="button"
            className="insp-inline-btn"
            onClick={resetPlacement}
            title="Reset image placement"
          >
            <Icon name="RotateCcw" size="0.85em" />
            <span>Reset</span>
          </button>
        </div>
      </div>
    </DisclosureSection>
  );
}

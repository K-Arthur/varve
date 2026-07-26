/**
 * ImagePlacementSection — fit mode, scale, offset, and reset controls
 * for shapes with image fills.
 *
 * Appears when a single ShapeNode with an image fill is selected.
 * Scale and offset are disabled when the fit mode is "stretch" because the
 * image is stretched to the shape bounds and offset/scale are irrelevant.
 *
 * Research basis: Figma image fill controls, Sketch image cropping,
 * Adobe Illustrator clip group placement.
 */
import type { ImageFillData, ImageFit, SceneNode, ShapeNode } from '@strata/scene';
import { getImageFill, isImageShape } from '@strata/scene';
import { Icon, Tooltip, TooltipProvider } from '@strata/ui';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { SegmentedControl } from '../controls/SegmentedControl';

const FIT_OPTIONS: readonly { readonly value: ImageFit; readonly label: string }[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'crop', label: 'Crop' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'tile', label: 'Tile' },
];

interface ImagePlacementSectionProps {
  nodes: SceneNode[];
}

export function ImagePlacementSection({ nodes }: ImagePlacementSectionProps) {
  const { updateDoc, setTool } = useEditor();
  const node = nodes[0];
  const nodeId = node?.id;

  const updateImage = useCallback(
    (patch: Partial<ImageFillData>) => {
      if (!nodeId) return;
      updateDoc((doc) => {
        const n = doc.nodes[nodeId];
        if (n?.kind !== 'shape') return doc;
        const fills = (n.fills ?? []).map((f) => {
          if (f.type !== 'image' || !f.image) return f;
          return { ...f, image: { ...f.image, ...patch } };
        });
        return {
          ...doc,
          nodes: { ...doc.nodes, [nodeId]: { ...n, fills } },
        };
      });
    },
    [nodeId, updateDoc],
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

  if (!node || nodes.length !== 1 || !isImageShape(node)) return null;
  const shapeNode = node as ShapeNode;
  const imageFill = getImageFill(shapeNode);
  if (!imageFill?.image) return null;
  const img = imageFill.image;

  const placementLocked = img.fit === 'stretch';

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
            disabled={placementLocked}
          />
        </FieldRow>

        <div className="insp-field">
          <span className="insp-field__label" style={{ cursor: 'default' }}>
            Offset
          </span>
          <div className="insp-field__control">
            <NumberField
              label="X"
              value={img.x ?? 0}
              step={1}
              onChange={handleOffsetX}
              unit="px"
              disabled={placementLocked}
            />
            <NumberField
              label="Y"
              value={img.y ?? 0}
              step={1}
              onChange={handleOffsetY}
              unit="px"
              disabled={placementLocked}
            />
          </div>
        </div>

        <div className="insp-image-placement__actions">
          <TooltipProvider>
            <Tooltip label="Edit crop (C)">
              <button type="button" className="insp-btn-sm" onClick={() => setTool('crop')}>
                <Icon name="Crop" size="0.85em" />
                <span>Edit crop</span>
              </button>
            </Tooltip>
            <Tooltip label="Reset image placement">
              <button type="button" className="insp-btn-sm" onClick={resetPlacement}>
                <Icon name="RotateCcw" size="0.85em" />
                <span>Reset placement</span>
              </button>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </DisclosureSection>
  );
}

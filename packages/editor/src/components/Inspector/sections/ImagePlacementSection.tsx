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
import type { ImageFillData, ImageFit, SceneNode, ShapeNode } from '@varve/scene';
import { getImageFill, isImageShape } from '@varve/scene';
import { Icon, Tooltip, TooltipProvider } from '@varve/ui';
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
  const imageNodes = nodes.filter(isImageShape) as ShapeNode[];

  const updateImages = useCallback(
    (patch: Partial<ImageFillData>) => {
      if (imageNodes.length === 0) return;
      const ids = imageNodes.map((n) => n.id);
      updateDoc((doc) => {
        let changed = false;
        const nextNodes = { ...doc.nodes };
        for (const id of ids) {
          const n = nextNodes[id];
          if (n?.kind !== 'shape') continue;
          const fills = (n.fills ?? []).map((f) => {
            if (f.type !== 'image' || !f.image) return f;
            return { ...f, image: { ...f.image, ...patch } };
          });
          nextNodes[id] = { ...n, fills } as SceneNode;
          changed = true;
        }
        return changed ? { ...doc, nodes: nextNodes } : doc;
      });
    },
    [imageNodes, updateDoc],
  );

  const handleFitChange = useCallback(
    (value: string) => updateImages({ fit: value as ImageFit }),
    [updateImages],
  );

  const handleOffsetX = useCallback((v: number) => updateImages({ x: v }), [updateImages]);

  const handleOffsetY = useCallback((v: number) => updateImages({ y: v }), [updateImages]);

  const handleScale = useCallback(
    (v: number) => updateImages({ scale: Math.max(0.01, v) }),
    [updateImages],
  );

  const resetPlacement = useCallback(() => {
    updateImages({ x: 0, y: 0, scale: 1, fit: 'fill' });
  }, [updateImages]);

  if (imageNodes.length === 0) return null;
  const firstNode = imageNodes[0]!;
  const firstImageFill = getImageFill(firstNode);
  if (!firstImageFill?.image) return null;

  const firstImg = firstImageFill.image;
  const allSameFit = imageNodes.every((n) => getImageFill(n)?.image?.fit === firstImg.fit);
  const fitValue = allSameFit ? (firstImg.fit ?? 'fill') : 'fill';
  const placementLocked = fitValue === 'stretch';

  const isMulti = imageNodes.length > 1;

  return (
    <DisclosureSection title="Image Placement" sectionId="image-placement">
      <div className="insp-field-group">
        <FieldRow label="Fit">
          <SegmentedControl
            label="Image fit mode"
            options={FIT_OPTIONS}
            value={fitValue}
            onChange={handleFitChange}
          />
        </FieldRow>

        <FieldRow label="Scale">
          <NumberField
            label="Image scale"
            value={firstImg.scale ?? 1}
            min={0.01}
            max={100}
            step={0.1}
            onChange={handleScale}
            unit="x"
            labelWrap
            disabled={placementLocked}
          />
        </FieldRow>

        <div className="insp-field">
          <span className="insp-field__label" style={{ cursor: 'default' }}>
            Offset
          </span>
          <div className="insp-field__control">
            <NumberField
              label="Offset X"
              displayLabel="X"
              value={firstImg.x ?? 0}
              step={1}
              onChange={handleOffsetX}
              unit="px"
              disabled={placementLocked}
            />
            <NumberField
              label="Offset Y"
              displayLabel="Y"
              value={firstImg.y ?? 0}
              step={1}
              onChange={handleOffsetY}
              unit="px"
              disabled={placementLocked}
            />
          </div>
        </div>

        <div className="insp-image-placement__actions">
          <TooltipProvider>
            {!isMulti && (
              <Tooltip label="Edit crop (C)">
                <button type="button" className="insp-btn-sm" onClick={() => setTool('crop')}>
                  <Icon name="Crop" size="0.85em" />
                  <span>Edit crop</span>
                </button>
              </Tooltip>
            )}
            <Tooltip
              label={
                isMulti
                  ? `Reset placement for ${imageNodes.length} images`
                  : 'Reset image placement'
              }
            >
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

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
import { commonValue, isMixed } from '../selection/selectionState';

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
  const fitRaw = commonValue(imageNodes, (n) => getImageFill(n)?.image?.fit ?? 'fill');
  const fitValue: ImageFit = isMixed(fitRaw) ? 'fill' : (fitRaw as ImageFit);
  const fitMixed = isMixed(fitRaw);
  const scaleRaw = commonValue(imageNodes, (n) => getImageFill(n)?.image?.scale ?? 1);
  const offsetXRaw = commonValue(imageNodes, (n) => getImageFill(n)?.image?.x ?? 0);
  const offsetYRaw = commonValue(imageNodes, (n) => getImageFill(n)?.image?.y ?? 0);
  const placementLocked = fitValue === 'stretch';

  const isMulti = imageNodes.length > 1;
  // Stretch pins the image to the shape bounds, so scale/offset would be inert;
  // every other mode uses them (tile included, via scale).
  const showOffsetAndScale = fitValue !== 'stretch' || fitMixed;

  return (
    <DisclosureSection title="Image Placement" sectionId="image-placement">
      <div className="insp-field-group">
        {/* Full-width five-up track: the fit modes are the section's primary
            decision, so they get the row rather than a cramped 38% column. */}
        <div className="insp-field insp-field--stacked">
          <span className="insp-field__label">Fit</span>
          <div className="insp-field__control">
            <SegmentedControl
              label="Image fit mode"
              className="insp-segmented--fit"
              options={FIT_OPTIONS}
              value={fitValue}
              onChange={handleFitChange}
            />
          </div>
        </div>
        {fitMixed && (
          <p className="insp-field__hint">
            Mixed fit modes — choosing one applies it to all images.
          </p>
        )}

        {showOffsetAndScale && (
          <FieldRow label="Scale">
            <NumberField
              label="Scale"
              hideLabel
              value={isMixed(scaleRaw) ? 1 : scaleRaw}
              mixed={isMixed(scaleRaw)}
              min={0.01}
              max={100}
              step={0.1}
              onChange={handleScale}
              unit="x"
              disabled={placementLocked}
            />
          </FieldRow>
        )}

        {showOffsetAndScale && (
          <div className="insp-field">
            <span className="insp-field__label">Offset</span>
            <div className="insp-field__control">
              <NumberField
                label="Offset X"
                displayLabel="X"
                value={isMixed(offsetXRaw) ? 0 : offsetXRaw}
                mixed={isMixed(offsetXRaw)}
                step={1}
                onChange={handleOffsetX}
                unit="px"
              />
              <NumberField
                label="Offset Y"
                displayLabel="Y"
                value={isMixed(offsetYRaw) ? 0 : offsetYRaw}
                mixed={isMixed(offsetYRaw)}
                step={1}
                onChange={handleOffsetY}
                unit="px"
              />
            </div>
          </div>
        )}

        {placementLocked && <p className="insp-field__hint">Stretch ignores offset and scale.</p>}

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

/**
 * ImagePlacementSection — selection-wide scale, offset, and reset controls
 * for shapes with image fills. Per-paint Fit/Rotation/Flip controls live in
 * the Fill section because those values belong to ImageFillData and can differ
 * between stacked image paints.
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
import { commonValue, isMixed } from '../selection/selectionState';

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

  const imageData = (node: SceneNode) =>
    node.kind === 'shape' ? getImageFill(node)?.image : undefined;
  const fitRaw = commonValue(imageNodes, (n) => imageData(n)?.fit ?? 'fill');
  const fitValue: ImageFit = isMixed(fitRaw) ? 'fill' : (fitRaw as ImageFit);
  const fitMixed = isMixed(fitRaw);
  const scaleRaw = commonValue(imageNodes, (n) => imageData(n)?.scale ?? 1);
  const offsetXRaw = commonValue(imageNodes, (n) => imageData(n)?.x ?? 0);
  const offsetYRaw = commonValue(imageNodes, (n) => imageData(n)?.y ?? 0);
  const placementLocked = fitValue === 'stretch';

  const isMulti = imageNodes.length > 1;
  // Stretch pins the image to the shape bounds, so scale/offset would be inert;
  // every other mode uses them (tile included, via scale).
  const showOffsetAndScale = fitValue !== 'stretch' || fitMixed;

  return (
    <DisclosureSection title="Image Placement" sectionId="image-placement">
      <div className="insp-field-group">
        {(fitMixed || placementLocked) && (
          <p className="insp-field__hint">
            {fitMixed
              ? 'Mixed fit modes — choose Fit in the Fill section for each image paint.'
              : 'Stretch ignores offset and scale; change Fit in the Fill section.'}
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
                  : 'Reset image placement and image fit'
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

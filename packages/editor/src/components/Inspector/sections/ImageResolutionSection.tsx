/**
 * ImageResolutionSection — read-only diagnostics for placed raster images.
 *
 * Shows source pixel dimensions, placed physical size, effective resolution
 * (PPI), and a low-resolution warning when the effective PPI is below the
 * standard print threshold (300 PPI).
 *
 * Research basis: Figma image info panel, Adobe Illustrator placed-link panel,
 * InDesign image effective PPI display.
 */
import type { SceneNode, ShapeNode } from '@varve/scene';
import { getImageFill, isImageShape, shapeHeight, shapeWidth } from '@varve/scene';
import { effectiveRasterPpiForNode, physicalSizeForDocumentBounds } from '@varve/scene/export';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

const PRINT_PPI_THRESHOLD = 300;

interface ImageResolutionSectionProps {
  nodes: SceneNode[];
}

export function ImageResolutionSection({ nodes }: ImageResolutionSectionProps) {
  const { state } = useEditor();
  const doc = state.document;
  const node = nodes[0];

  const diagnostics = useMemo(() => {
    if (!node || nodes.length !== 1 || !isImageShape(node)) return null;
    const shapeNode = node as ShapeNode;
    const imageFill = getImageFill(shapeNode);
    const img = imageFill?.image;
    if (!img) return null;

    const asset = img.assetId ? doc.assets?.[img.assetId] : undefined;
    const nativeWidth = asset?.naturalWidth ?? asset?.metadata?.pixelWidth ?? img.imageWidth;
    const nativeHeight = asset?.naturalHeight ?? asset?.metadata?.pixelHeight ?? img.imageHeight;

    const boundsW = shapeWidth(shapeNode.shape);
    const boundsH = shapeHeight(shapeNode.shape);
    const { widthInches, heightInches } = physicalSizeForDocumentBounds({
      width: boundsW,
      height: boundsH,
    });

    const eff = effectiveRasterPpiForNode(doc, shapeNode);

    return {
      nativeWidth,
      nativeHeight,
      placedWidthMm: widthInches * 25.4,
      placedHeightMm: heightInches * 25.4,
      effectivePpi: eff?.minimumPpi ?? null,
      available: eff?.available ?? false,
    };
  }, [node, nodes.length, doc]);

  if (!diagnostics?.nativeWidth || !diagnostics.nativeHeight) return null;

  const { nativeWidth, nativeHeight, placedWidthMm, placedHeightMm, effectivePpi, available } =
    diagnostics;

  const belowThreshold = available && effectivePpi !== null && effectivePpi < PRINT_PPI_THRESHOLD;
  const ppiLabel = !available
    ? 'N/A'
    : effectivePpi !== null
      ? `${Math.round(effectivePpi)} PPI`
      : '—';

  return (
    <DisclosureSection title="Image Resolution" sectionId="image-resolution">
      <div className="insp-field-group">
        <div className="insp-field">
          <span className="insp-field__label">Source pixels</span>
          <div className="insp-field__control">
            <span>
              {nativeWidth} x {nativeHeight} px
            </span>
          </div>
        </div>

        <div className="insp-field">
          <span className="insp-field__label">Placed size</span>
          <div className="insp-field__control">
            <span>
              {placedWidthMm.toFixed(1)} x {placedHeightMm.toFixed(1)} mm
            </span>
          </div>
        </div>

        <div className="insp-field">
          <span className="insp-field__label insp-field__label--wrap">Effective resolution</span>
          <div className="insp-field__control">
            <span style={belowThreshold ? { color: 'var(--color-feedback-warning)' } : undefined}>
              {ppiLabel}
            </span>
          </div>
        </div>
      </div>

      {belowThreshold && (
        <p className="insp-hint insp-hint--warn" role="status">
          This image may appear soft in print output at the current placed size.
        </p>
      )}
    </DisclosureSection>
  );
}

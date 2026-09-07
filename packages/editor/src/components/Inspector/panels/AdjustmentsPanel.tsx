import { canHaveSmartFilters, isImageShape } from '@varve/scene';
import { EmptyState } from '@varve/ui';
import { useEditor } from '../../../context';
import { AdjustmentPanel } from '../../AdjustmentLayer/AdjustmentPanel';
import { AdjustmentLayerAccessSection } from '../sections/AdjustmentLayerAccessSection';
import { AIDenoiseSection } from '../sections/AIDenoiseSection';
import { BackgroundRemovalSection } from '../sections/BackgroundRemovalSection';
import { BlendImagesSection } from '../sections/BlendImagesSection';
import { ColorizeSection } from '../sections/ColorizeSection';
import { ContentAwareFillSection } from '../sections/ContentAwareFillSection';
import { DetectTextSection } from '../sections/DetectTextSection';
import { EffectStudioAccessSection } from '../sections/EffectStudioAccessSection';
import { EffectsSection } from '../sections/EffectsSection';
import { FontDetectSection } from '../sections/FontDetectSection';
import { ImageEnhancementSection } from '../sections/ImageEnhancementSection';
import { ImageTuningSection } from '../sections/ImageTuningSection';
import { LensBlurSection } from '../sections/LensBlurSection';
import { LineArtSection } from '../sections/LineArtSection';
import { OcrSection } from '../sections/OcrSection';
import { SmartFiltersSection } from '../sections/SmartFiltersSection';

/**
 * Focused image-processing surface. This module is lazy-loaded so model-aware
 * editors and preview effects do not enter the Properties render path. Object
 * selections use the same tab for compact Effect Studio access plus the
 * complete editable Object Filter and Layer Effects workflow; the raster-only
 * controls stay image-gated.
 */
export function AdjustmentsPanel() {
  const { selectedNodes, openCafDialog } = useEditor();
  const nodes = selectedNodes();
  const node = nodes[0];

  if (nodes.length === 1 && node?.kind === 'adjustment') {
    return <AdjustmentPanel />;
  }

  const allImages = nodes.length > 0 && nodes.every(isImageShape);
  if (!allImages) {
    if (nodes.length > 0 && nodes.every(canHaveSmartFilters)) {
      return (
        <div className="adjustments-object-panel">
          <AdjustmentLayerAccessSection nodes={nodes} />
          <EffectStudioAccessSection nodes={nodes} />
          <SmartFiltersSection nodes={nodes} />
          <EffectsSection nodes={nodes} />
        </div>
      );
    }

    return (
      <EmptyState
        illustration={<span aria-hidden />}
        headline={
          nodes.length === 0 ? 'Select an image or adjustment layer' : 'Image Tuning is raster-only'
        }
        description={
          nodes.length === 0
            ? 'Use Image Tuning for a selected raster image. Select an Adjustment Layer to edit a scoped correction, or create one from Properties or Object.'
            : 'Use Effect Studio for object-local creative treatments. For a shared raster-and-vector correction, add an Adjustment Layer from Properties or Object.'
        }
      />
    );
  }

  return (
    <>
      <ImageTuningSection nodes={nodes} />
      {nodes.length === 1 && (
        <>
          <ImageEnhancementSection nodes={nodes} />
          <BackgroundRemovalSection nodes={nodes} />
          <ColorizeSection nodes={nodes} />
          <AIDenoiseSection nodes={nodes} />
          <LensBlurSection nodes={nodes} />
          <LineArtSection nodes={nodes} />
          <ContentAwareFillSection nodes={nodes} onOpenDialog={openCafDialog} />
          <DetectTextSection nodes={nodes} />
          <OcrSection nodes={nodes} />
          <FontDetectSection nodes={nodes} />
          <BlendImagesSection nodes={nodes} />
        </>
      )}
    </>
  );
}

import { isImageShape } from '@varve/scene';
import { EmptyState } from '@varve/ui';
import { useEditor } from '../../../context';
import { AdjustmentPanel } from '../../AdjustmentLayer/AdjustmentPanel';
import { AIDenoiseSection } from '../sections/AIDenoiseSection';
import { BackgroundRemovalSection } from '../sections/BackgroundRemovalSection';
import { BlendImagesSection } from '../sections/BlendImagesSection';
import { ColorizeSection } from '../sections/ColorizeSection';
import { ContentAwareFillSection } from '../sections/ContentAwareFillSection';
import { DetectTextSection } from '../sections/DetectTextSection';
import { FontDetectSection } from '../sections/FontDetectSection';
import { ImageEnhancementSection } from '../sections/ImageEnhancementSection';
import { ImageTuningSection } from '../sections/ImageTuningSection';
import { LensBlurSection } from '../sections/LensBlurSection';
import { LineArtSection } from '../sections/LineArtSection';
import { OcrSection } from '../sections/OcrSection';

/**
 * Focused image-processing surface. This module is lazy-loaded so model-aware
 * editors and preview effects do not enter the Properties render path.
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

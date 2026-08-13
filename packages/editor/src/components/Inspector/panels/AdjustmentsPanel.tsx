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

  if (nodes.length !== 1 || !node || !isImageShape(node)) {
    return (
      <EmptyState
        illustration={<span aria-hidden />}
        headline="Select an image"
        description="Image enhancement, cleanup, recognition, and compositing tools appear here."
      />
    );
  }

  return (
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
  );
}

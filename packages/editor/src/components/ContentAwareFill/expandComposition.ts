import type { ExpandPlan, ExpandWorkingFrame } from '@varve/engine';

/**
 * Placement geometry for the full-resolution expanded output.
 *
 * The generated result is produced at the proxy working size; composition
 * draws the authoritative full-resolution source into the protected rectangle
 * and then draws the generated frame through a border clip, so no generated
 * pixel can ever touch the retained source.
 */
export interface ExpandedCompositionLayout {
  outputWidth: number;
  outputHeight: number;
  source: {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
  };
  generated: {
    dx: number;
    dy: number;
    dw: number;
    dh: number;
  };
  protectedExclusion: { x: number; y: number; width: number; height: number };
}

export function expandCompositionLayout(
  plan: ExpandPlan,
  generatedWidth: number,
  generatedHeight: number,
): ExpandedCompositionLayout {
  if (
    !Number.isSafeInteger(generatedWidth) ||
    !Number.isSafeInteger(generatedHeight) ||
    generatedWidth <= 0 ||
    generatedHeight <= 0
  ) {
    throw new Error('Generated expansion frame dimensions are invalid');
  }
  return {
    outputWidth: plan.outputWidth,
    outputHeight: plan.outputHeight,
    source: {
      sx: 0,
      sy: 0,
      sw: plan.sourceWidth,
      sh: plan.sourceHeight,
      dx: plan.sourceOffsetX,
      dy: plan.sourceOffsetY,
      dw: plan.sourceWidth,
      dh: plan.sourceHeight,
    },
    generated: {
      dx: 0,
      dy: 0,
      dw: plan.outputWidth,
      dh: plan.outputHeight,
    },
    protectedExclusion: {
      x: plan.sourceOffsetX,
      y: plan.sourceOffsetY,
      width: plan.sourceWidth,
      height: plan.sourceHeight,
    },
  };
}

function drawableFromImageData(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Compose the reviewed full-resolution expansion.
 *
 * The source rectangle is drawn from the decoded full-resolution source, and
 * the generated proxy frame is enlarged into the output while clipped to the
 * border, excluding the protected rectangle with the even-odd rule. This keeps
 * protected pixels independent of any provider behavior, and keeps the
 * reviewed candidate identical to the accepted asset.
 */
export function composeExpandedFullResolution(options: {
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  plan: ExpandPlan;
  generated: ImageData;
  working: ExpandWorkingFrame;
}): HTMLCanvasElement {
  const { source, sourceWidth, sourceHeight, plan, generated, working } = options;
  if (
    sourceWidth !== plan.sourceWidth ||
    sourceHeight !== plan.sourceHeight ||
    generated.width !== working.outputWidth ||
    generated.height !== working.outputHeight
  ) {
    throw new Error('Expanded composition inputs do not match the expansion plan');
  }
  const layout = expandCompositionLayout(plan, generated.width, generated.height);
  const output = document.createElement('canvas');
  output.width = layout.outputWidth;
  output.height = layout.outputHeight;
  const context = output.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    layout.source.sx,
    layout.source.sy,
    layout.source.sw,
    layout.source.sh,
    layout.source.dx,
    layout.source.dy,
    layout.source.dw,
    layout.source.dh,
  );

  const generatedCanvas = drawableFromImageData(generated);
  context.save();
  context.beginPath();
  context.rect(0, 0, layout.outputWidth, layout.outputHeight);
  context.rect(
    layout.protectedExclusion.x,
    layout.protectedExclusion.y,
    layout.protectedExclusion.width,
    layout.protectedExclusion.height,
  );
  context.clip('evenodd');
  context.drawImage(
    generatedCanvas,
    0,
    0,
    generatedCanvas.width,
    generatedCanvas.height,
    layout.generated.dx,
    layout.generated.dy,
    layout.generated.dw,
    layout.generated.dh,
  );
  context.restore();

  return output;
}

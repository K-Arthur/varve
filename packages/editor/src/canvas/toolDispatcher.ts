/**
 * Tool dispatcher — singleton ToolManager and all tool registrations.
 * Extracted from CanvasArea to reduce import weight and cyclomatic complexity.
 */

import { ToolManager } from '../tools';
import { ArrowTool } from '../tools/ArrowTool';
import { CloneStampTool } from '../tools/CloneStampTool';
import { CropTool } from '../tools/CropTool';
import { EllipseTool } from '../tools/EllipseTool';
import { EyedropperTool } from '../tools/EyedropperTool';
import { FloatingTransformTool } from '../tools/FloatingTransformTool';
import { FrameTool } from '../tools/FrameTool';
import { HandTool } from '../tools/HandTool';
import { HealingBrushTool } from '../tools/HealingBrushTool';
import { LassoTool } from '../tools/LassoTool';
import { LineTool } from '../tools/LineTool';
import { MagicWandTool } from '../tools/MagicWandTool';
import { MarqueeTool } from '../tools/MarqueeTool';
import { NodeEditTool } from '../tools/NodeEditTool';
import { PageTool } from '../tools/PageTool';
import { PaintTool } from '../tools/PaintTool';
import { PatchTool } from '../tools/PatchTool';
import { PencilTool } from '../tools/PencilTool';
import { PenTool } from '../tools/PenTool';
import { PerspectiveTool } from '../tools/PerspectiveTool';
import { PixelLassoTool } from '../tools/PixelLassoTool';
import { PixelProbeTool } from '../tools/PixelProbeTool';
import { PolygonTool } from '../tools/PolygonTool';
import { RectangleTool } from '../tools/RectangleTool';
import { RefineMaskTool } from '../tools/RefineMaskTool';
import { Sam2SegmentationTool } from '../tools/Sam2SegmentationTool';
import { ScaleTool } from '../tools/ScaleTool';
import { SelectionBoundaryTool } from '../tools/SelectionBoundaryTool';
import { SelectionPaintTool } from '../tools/SelectionPaintTool';
import { SelectTool } from '../tools/SelectTool';
import { SliceTool } from '../tools/SliceTool';
import { SmudgeTool } from '../tools/SmudgeTool';
import { SpotHealTool } from '../tools/SpotHealTool';
import { StarTool } from '../tools/StarTool';
import { TableTool } from '../tools/TableTool';
import { TextTool } from '../tools/TextTool';
import { TrimapEditTool } from '../tools/TrimapEditTool';
import { WarpTool } from '../tools/WarpTool';
import { ZoomTool } from '../tools/ZoomTool';

let toolManager: ToolManager | null = null;

export function getToolManager(): ToolManager {
  if (!toolManager) {
    toolManager = new ToolManager('select');
    toolManager.register('select', () => new SelectTool());
    toolManager.register('inspect', () => new SelectTool());
    toolManager.register('hand', () => new HandTool());
    toolManager.register('zoom', () => new ZoomTool());
    toolManager.register('scale', () => new ScaleTool());
    toolManager.register('frame', () => new FrameTool());
    toolManager.register('rect', () => new RectangleTool());
    toolManager.register('ellipse', () => new EllipseTool());
    toolManager.register('line', () => new LineTool());
    toolManager.register('arrow', () => new ArrowTool());
    toolManager.register('polygon', () => new PolygonTool());
    toolManager.register('star', () => new StarTool());
    toolManager.register('pen', () => new PenTool());
    toolManager.register('pencil', () => new PencilTool());
    toolManager.register('text', () => new TextTool());
    toolManager.register('slice', () => new SliceTool());
    toolManager.register('eyedropper', () => new EyedropperTool());
    toolManager.register('nodeEdit', () => new NodeEditTool());
    toolManager.register('page', () => new PageTool());
    toolManager.register('cloneStamp', () => new CloneStampTool());
    toolManager.register('healBrush', () => new HealingBrushTool());
    toolManager.register('spotHeal', () => new SpotHealTool());
    toolManager.register('patch', () => new PatchTool());
    toolManager.register('pixelProbe', () => new PixelProbeTool());
    toolManager.register('refineMask', () => new RefineMaskTool());
    toolManager.register('trimapEdit', () => new TrimapEditTool());
    toolManager.register('crop', () => new CropTool());
    toolManager.register('paint', () => new PaintTool(false));
    toolManager.register('eraser', () => new PaintTool(true));
    toolManager.register('smudge', () => new SmudgeTool());
    toolManager.register('sam2Segment', () => new Sam2SegmentationTool());
    toolManager.register('lasso', () => new LassoTool());
    toolManager.register('pixelLasso', () => new PixelLassoTool());
    toolManager.register('marquee', () => new MarqueeTool());
    toolManager.register('ellipseMarquee', () => new MarqueeTool('ellipse'));
    toolManager.register('selectionPaint', () => new SelectionPaintTool());
    toolManager.register('magicWand', () => new MagicWandTool());
    toolManager.register('floatingTransform', () => new FloatingTransformTool());
    toolManager.register('selectionBoundary', () => new SelectionBoundaryTool());
    toolManager.register('table', () => new TableTool());
    toolManager.register('warp', () => new WarpTool());
    toolManager.register('perspective', () => new PerspectiveTool());
  }
  return toolManager;
}

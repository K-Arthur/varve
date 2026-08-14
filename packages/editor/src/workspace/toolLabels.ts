import type { ToolId } from '../tools/types';

/** Tools that must remain reachable for selection and canvas navigation. */
export const ESSENTIAL_TOOL_IDS: ReadonlySet<ToolId> = new Set(['select', 'hand', 'zoom']);

const TOOL_LABELS: Partial<Record<ToolId, string>> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  arrow: 'Arrow',
  text: 'Text',
  pen: 'Pen',
  pencil: 'Pencil',
  frame: 'Frame',
  select: 'Select',
  nodeEdit: 'Node Edit',
  hand: 'Hand',
  zoom: 'Zoom',
  crop: 'Crop',
  slice: 'Slice',
  eyedropper: 'Eyedropper',
  scale: 'Scale',
  inspect: 'Inspect',
  paint: 'Paint Brush',
  eraser: 'Eraser',
  cloneStamp: 'Clone Stamp',
  healBrush: 'Healing Brush',
  spotHeal: 'Spot Heal',
  patch: 'Patch Tool',
  smudge: 'Smudge',
  sam2Segment: 'Select Subject',
  lasso: 'Lasso',
  table: 'Table',
  warp: 'Warp',
};

/** Stable display label for toolbar and workspace-customization surfaces. */
export function toolLabel(toolId: string): string {
  const known = TOOL_LABELS[toolId as ToolId];
  if (known) return known;
  return toolId.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (first) => first.toUpperCase());
}

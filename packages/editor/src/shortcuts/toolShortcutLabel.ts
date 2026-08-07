import type { ToolId } from '../tools/types';
import { formatShortcut, getEffectiveBinding } from './ShortcutManager';

const TOOL_SHORTCUT_IDS: Partial<Record<ToolId, string>> = {
  select: 'toolSelect',
  lasso: 'toolLasso',
  hand: 'toolHand',
  zoom: 'toolZoom',
  frame: 'toolFrame',
  rect: 'toolRect',
  ellipse: 'toolEllipse',
  line: 'toolLine',
  arrow: 'toolArrow',
  pen: 'toolPen',
  pencil: 'toolPencil',
  text: 'toolText',
  scale: 'toolScale',
  slice: 'toolSlice',
  eyedropper: 'toolEyedropper',
  inspect: 'toolInspect',
  paint: 'toolPaint',
  eraser: 'toolEraser',
  cloneStamp: 'toolCloneStamp',
  healBrush: 'toolHealBrush',
  spotHeal: 'toolSpotHeal',
  patch: 'toolPatch',
  smudge: 'toolSmudge',
  sam2Segment: 'toolSam2Segment',
  page: 'toolPage',
};

/** Registry action id that carries a tool's shortcut, if the tool has one. */
export function toolShortcutId(id: ToolId): string | undefined {
  return TOOL_SHORTCUT_IDS[id];
}

export function toolShortcutLabel(id: ToolId): string | undefined {
  const sid = TOOL_SHORTCUT_IDS[id];
  if (!sid) return undefined;
  const binding = getEffectiveBinding(sid);
  return binding?.key ? formatShortcut(binding) : undefined;
}

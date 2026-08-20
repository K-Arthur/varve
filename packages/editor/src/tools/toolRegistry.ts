/**
 * Canonical editor tool registry.
 *
 * `ToolId` is the type-level contract, but this registry is the runtime
 * authority for the metadata that surfaces need: labels, icons, categories,
 * activation kind, protected recovery tools, and shortcut relationships.
 * Workspace configs own presentation (order and composition); they do not
 * redefine tool identity.
 */

import type { IconName } from '@varve/ui';

export type ToolKind = 'tool' | 'command';

export type ToolCategory =
  | 'navigation'
  | 'selection'
  | 'shapes'
  | 'vector'
  | 'typography'
  | 'drawing'
  | 'raster'
  | 'ai'
  | 'layout'
  | 'inspect'
  | 'prototype'
  | 'collaboration';

export interface ToolDefinition {
  id: string;
  label: string;
  icon: IconName;
  category: ToolCategory;
  kind: ToolKind;
  /** A short search vocabulary for customization and command surfaces. */
  aliases?: readonly string[];
  /** Shortcut registry id, when this tool has a registered shortcut. */
  shortcutId?: string;
  /** Protected tools cannot be removed from the toolbar. */
  essential?: boolean;
}

export const TOOL_REGISTRY = [
  {
    id: 'select',
    label: 'Select',
    icon: 'MousePointer2',
    category: 'navigation',
    kind: 'tool',
    shortcutId: 'toolSelect',
    essential: true,
  },
  {
    id: 'frame',
    label: 'Frame',
    icon: 'Frame',
    category: 'layout',
    kind: 'tool',
    shortcutId: 'toolFrame',
    aliases: ['artboard', 'container'],
  },
  {
    id: 'rect',
    label: 'Rectangle',
    icon: 'Square',
    category: 'shapes',
    kind: 'tool',
    shortcutId: 'toolRect',
    aliases: ['square'],
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    icon: 'Circle',
    category: 'shapes',
    kind: 'tool',
    shortcutId: 'toolEllipse',
    aliases: ['circle'],
  },
  {
    id: 'polygon',
    label: 'Polygon',
    icon: 'Pentagon',
    category: 'shapes',
    kind: 'tool',
    aliases: ['multi-sided shape'],
  },
  {
    id: 'star',
    label: 'Star',
    icon: 'Star',
    category: 'shapes',
    kind: 'tool',
  },
  {
    id: 'line',
    label: 'Line',
    icon: 'Minus',
    category: 'vector',
    kind: 'tool',
    shortcutId: 'toolLine',
  },
  {
    id: 'arrow',
    label: 'Arrow',
    icon: 'ArrowRight',
    category: 'vector',
    kind: 'tool',
    shortcutId: 'toolArrow',
  },
  {
    id: 'pen',
    label: 'Pen',
    icon: 'Pen',
    category: 'vector',
    kind: 'tool',
    shortcutId: 'toolPen',
    aliases: ['bezier', 'path'],
  },
  {
    id: 'pencil',
    label: 'Pencil',
    icon: 'Pencil',
    category: 'drawing',
    kind: 'tool',
    shortcutId: 'toolPencil',
    aliases: ['freehand'],
  },
  {
    id: 'nodeEdit',
    label: 'Node Edit',
    icon: 'SplinePointer',
    category: 'vector',
    kind: 'tool',
    aliases: ['nodes', 'points'],
  },
  {
    id: 'text',
    label: 'Text',
    icon: 'Type',
    category: 'typography',
    kind: 'tool',
    shortcutId: 'toolText',
    aliases: ['type'],
  },
  {
    id: 'hand',
    label: 'Hand',
    icon: 'Hand',
    category: 'navigation',
    kind: 'tool',
    shortcutId: 'toolHand',
    essential: true,
  },
  {
    id: 'zoom',
    label: 'Zoom',
    icon: 'ZoomIn',
    category: 'navigation',
    kind: 'tool',
    shortcutId: 'toolZoom',
    essential: true,
  },
  {
    id: 'scale',
    label: 'Scale',
    icon: 'Maximize2',
    category: 'selection',
    kind: 'tool',
    shortcutId: 'toolScale',
    aliases: ['resize'],
  },
  {
    id: 'image',
    label: 'Image',
    icon: 'Image',
    category: 'raster',
    kind: 'tool',
    aliases: ['place image', 'photo'],
  },
  {
    id: 'slice',
    label: 'Slice',
    icon: 'Scissors',
    category: 'layout',
    kind: 'tool',
    shortcutId: 'toolSlice',
    aliases: ['export region'],
  },
  {
    id: 'eyedropper',
    label: 'Eyedropper',
    icon: 'Pipette',
    category: 'selection',
    kind: 'tool',
    aliases: ['color picker', 'sample color'],
  },
  {
    id: 'inspect',
    label: 'Inspect',
    icon: 'SearchCode',
    category: 'inspect',
    kind: 'tool',
    shortcutId: 'toolInspect',
    aliases: ['measure', 'handoff'],
  },
  {
    id: 'booleanUnion',
    label: 'Boolean Union',
    icon: 'Combine',
    category: 'vector',
    kind: 'command',
    shortcutId: 'booleanUnion',
    aliases: ['union', 'add'],
  },
  {
    id: 'booleanSubtract',
    label: 'Boolean Subtract',
    icon: 'Diff',
    category: 'vector',
    kind: 'command',
    shortcutId: 'booleanSubtract',
    aliases: ['subtract', 'minus'],
  },
  {
    id: 'booleanIntersect',
    label: 'Boolean Intersect',
    icon: 'Blend',
    category: 'vector',
    kind: 'command',
    shortcutId: 'booleanIntersect',
    aliases: ['intersect'],
  },
  {
    id: 'booleanExclude',
    label: 'Boolean Exclude',
    icon: 'CircleX',
    category: 'vector',
    kind: 'command',
    shortcutId: 'booleanExclude',
    aliases: ['exclude', 'xor'],
  },
  {
    id: 'cloneStamp',
    label: 'Clone Stamp',
    icon: 'Stamp',
    category: 'raster',
    kind: 'tool',
    shortcutId: 'toolCloneStamp',
    aliases: ['clone'],
  },
  {
    id: 'healBrush',
    label: 'Healing Brush',
    icon: 'Bandage',
    category: 'raster',
    kind: 'tool',
    aliases: ['heal', 'retouch'],
  },
  {
    id: 'spotHeal',
    label: 'Spot Heal',
    icon: 'Wand',
    category: 'raster',
    kind: 'tool',
    aliases: ['healing', 'retouch'],
  },
  {
    id: 'patch',
    label: 'Patch Tool',
    icon: 'SquareStack',
    category: 'raster',
    kind: 'tool',
    aliases: ['retouch', 'repair'],
  },
  {
    id: 'refineMask',
    label: 'Refine Mask',
    icon: 'Paintbrush',
    category: 'raster',
    kind: 'tool',
    aliases: ['mask', 'matting'],
  },
  {
    id: 'trimapEdit',
    label: 'Trimap Edit',
    icon: 'Paintbrush',
    category: 'raster',
    kind: 'tool',
    aliases: ['mask', 'foreground', 'background'],
  },
  {
    id: 'crop',
    label: 'Crop',
    icon: 'Crop',
    category: 'raster',
    kind: 'tool',
    shortcutId: 'toolCrop',
    aliases: ['trim'],
  },
  {
    id: 'paint',
    label: 'Paint Brush',
    icon: 'Brush',
    category: 'drawing',
    kind: 'tool',
    shortcutId: 'toolPaint',
    aliases: ['brush', 'raster brush'],
  },
  {
    id: 'eraser',
    label: 'Eraser',
    icon: 'Eraser',
    category: 'drawing',
    kind: 'tool',
    shortcutId: 'toolEraser',
  },
  {
    id: 'smudge',
    label: 'Smudge',
    icon: 'FingerprintPattern',
    category: 'drawing',
    kind: 'tool',
    shortcutId: 'toolSmudge',
    aliases: ['blur', 'blend'],
  },
  {
    id: 'sam2Segment',
    label: 'Select Subject',
    icon: 'Scan',
    category: 'ai',
    kind: 'tool',
    shortcutId: 'toolSam2Segment',
    aliases: ['segmentation', 'mask', 'ai selection'],
  },
  {
    id: 'shape',
    label: 'Shape',
    icon: 'Square',
    category: 'shapes',
    kind: 'tool',
    aliases: ['generic shape'],
  },
  {
    id: 'connector',
    label: 'Connector',
    icon: 'Workflow',
    category: 'prototype',
    kind: 'tool',
    aliases: ['wire', 'link'],
  },
  {
    id: 'comment',
    label: 'Comment',
    icon: 'MessageCircle',
    category: 'collaboration',
    kind: 'command',
    aliases: ['annotation', 'note'],
  },
  {
    id: 'backgroundRemoval',
    label: 'Background Removal',
    icon: 'Eraser',
    category: 'ai',
    kind: 'command',
    aliases: ['remove background', 'cutout', 'mask'],
  },
  {
    id: 'clone',
    label: 'Clone',
    icon: 'Copy',
    category: 'raster',
    kind: 'command',
    aliases: ['duplicate image'],
  },
  {
    id: 'contentAwareFill',
    label: 'Content-Aware Fill',
    icon: 'WandSparkles',
    category: 'ai',
    kind: 'command',
    aliases: ['fill', 'remove object', 'heal'],
  },
  {
    id: 'lasso',
    label: 'Lasso',
    icon: 'LassoSelect',
    category: 'selection',
    kind: 'tool',
    shortcutId: 'toolLasso',
    aliases: ['freeform selection'],
  },
  {
    id: 'marquee',
    label: 'Rectangular Marquee',
    icon: 'SquareDashed',
    category: 'selection',
    kind: 'tool',
    aliases: ['pixel selection', 'rectangle selection', 'area selection'],
  },
  {
    id: 'table',
    label: 'Table',
    icon: 'Table',
    category: 'layout',
    kind: 'tool',
    aliases: ['grid', 'data table'],
  },
  {
    id: 'warp',
    label: 'Warp',
    icon: 'Spline',
    category: 'vector',
    kind: 'tool',
    aliases: ['deform', 'mesh'],
  },
  {
    id: 'page',
    label: 'Page',
    icon: 'FileText',
    category: 'layout',
    kind: 'tool',
    shortcutId: 'toolPage',
    aliases: ['page tool', 'spread'],
  },
] as const satisfies readonly ToolDefinition[];

/** Tool identity is derived from the runtime registry, not maintained twice. */
export type ToolId = (typeof TOOL_REGISTRY)[number]['id'];

const TOOL_BY_ID = new Map<ToolId, ToolDefinition>(
  TOOL_REGISTRY.map((definition) => [definition.id as ToolId, definition]),
);

/** All registered ids, in stable registry order. */
export function getRegisteredToolIds(): readonly ToolId[] {
  return TOOL_REGISTRY.map((definition) => definition.id as ToolId);
}

export function getRegisteredTools(): readonly ToolDefinition[] {
  return TOOL_REGISTRY;
}

export function getToolDefinition(id: string): ToolDefinition | undefined {
  return TOOL_BY_ID.get(id as ToolId);
}

export function toolDefinition(id: ToolId): ToolDefinition {
  return TOOL_BY_ID.get(id) ?? TOOL_REGISTRY[0]!;
}

export function toolLabel(id: string): string {
  return (
    getToolDefinition(id)?.label ??
    id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  );
}

export function toolIconName(id: ToolId): IconName {
  return toolDefinition(id).icon;
}

export function getToolIdForShortcutId(shortcutId: string): ToolId | undefined {
  return TOOL_REGISTRY.find(
    (definition) => 'shortcutId' in definition && definition.shortcutId === shortcutId,
  )?.id as ToolId | undefined;
}

export const ESSENTIAL_TOOL_IDS: ReadonlySet<ToolId> = new Set(
  TOOL_REGISTRY.filter((definition) => 'essential' in definition && definition.essential).map(
    (definition) => definition.id as ToolId,
  ),
);

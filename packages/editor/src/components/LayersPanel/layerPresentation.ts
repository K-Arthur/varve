import type { Document, LayerColor, SceneNode } from '@varve/scene';
import { isExportRegion, isImageShape, isTableNode } from '@varve/scene';
import type { SolidIconName } from '@varve/ui';
import { SOLID_TOOL_ICONS } from '@varve/ui';

/**
 * The small, stable vocabulary used by Layers rows. `dataType` intentionally
 * retains the existing high-level values used by context-menu tests and
 * automation; `category` and `subtype` carry the information that a row needs
 * to distinguish vector, raster, and structural objects visually.
 */
export type LayerPresentationCategory =
  | 'frame'
  | 'group'
  | 'component'
  | 'instance'
  | 'text'
  | 'vector'
  | 'raster'
  | 'adjustment'
  | 'table'
  | 'unknown';

export interface LayerPresentation {
  dataType: string;
  category: LayerPresentationCategory;
  subtype: string;
  label: string;
  icon: SolidIconName;
}

function isComponentDefinition(node: SceneNode, doc?: Document): boolean {
  if (node.kind !== 'frame' || node.componentId != null || !doc) return false;
  return Object.values(doc.components).some((component) => component.masterRootId === node.id);
}

/**
 * Resolve one canonical row presentation from the scene contract.
 *
 * This is deliberately derived from scene data instead of maintaining a UI
 * hierarchy or a second node-type registry. In particular, a component
 * definition is identified by a component's masterRootId, while a component
 * instance is identified by the frame's componentId. A frame with neither is
 * still an ordinary frame.
 */
export function resolveLayerPresentation(node: SceneNode, doc?: Document): LayerPresentation {
  if (node.kind === 'frame') {
    if (node.componentId != null) {
      return {
        dataType: 'instance',
        category: 'instance',
        subtype: 'component-instance',
        label: 'Component instance',
        icon: SOLID_TOOL_ICONS.component,
      };
    }
    if (isComponentDefinition(node, doc)) {
      return {
        dataType: 'component',
        category: 'component',
        subtype: 'component-definition',
        label: 'Component',
        icon: SOLID_TOOL_ICONS.component,
      };
    }
    if (isExportRegion(node)) {
      return {
        dataType: 'exportRegion',
        category: 'frame',
        subtype: 'export-region',
        label: 'Export region',
        icon: SOLID_TOOL_ICONS.slice,
      };
    }
    return {
      dataType: 'frame',
      category: 'frame',
      subtype: 'frame',
      label: 'Frame',
      icon: SOLID_TOOL_ICONS.frame,
    };
  }

  if (node.kind === 'group') {
    return {
      dataType: 'group',
      category: 'group',
      subtype: 'group',
      label: 'Group',
      icon: SOLID_TOOL_ICONS.group,
    };
  }

  if (node.kind === 'text') {
    return {
      dataType: 'text',
      category: 'text',
      subtype: 'text',
      label: 'Text',
      icon: SOLID_TOOL_ICONS.text,
    };
  }

  if (node.kind === 'adjustment') {
    return {
      dataType: 'adjustment',
      category: 'adjustment',
      subtype: node.adjustmentType,
      label: 'Adjustment layer',
      icon: SOLID_TOOL_ICONS.adjustment,
    };
  }

  if (node.kind === 'rasterLayer') {
    return {
      dataType: 'rasterLayer',
      category: 'raster',
      subtype: 'raster-layer',
      label: 'Raster layer',
      // Keep imported/image-filled shapes on the Image glyph; a native pixel
      // layer uses the file-image glyph so the two raster sources do not
      // collapse into the same visual token.
      icon: 'FileImage',
    };
  }

  if (isTableNode(node)) {
    return {
      dataType: 'table',
      category: 'unknown',
      subtype: 'table',
      label: 'Table',
      icon: SOLID_TOOL_ICONS.table,
    };
  }

  if (node.kind === 'shape') {
    if (isImageShape(node)) {
      return {
        dataType: 'image',
        category: 'raster',
        subtype: 'image-fill',
        label: 'Raster image',
        icon: SOLID_TOOL_ICONS.image,
      };
    }
    return {
      dataType: 'shape',
      category: 'vector',
      subtype: node.shape.kind,
      label: `Vector ${shapeLabel(node.shape.kind)}`,
      icon: shapeIcon(node.shape.kind),
    };
  }

  if (node.kind === 'path') {
    return {
      dataType: 'path',
      category: 'vector',
      subtype: 'path',
      label: 'Vector path',
      icon: 'Pen',
    };
  }

  // Keep a runtime fallback for documents produced by a newer scene schema;
  // the current TypeScript union is exhaustive, so access the discriminant
  // through a narrow compatibility view instead of making the default branch
  // unreachable to the compiler.
  const unknownKind = (node as { kind: string }).kind;
  return {
    dataType: unknownKind,
    category: 'unknown',
    subtype: unknownKind,
    label: 'Layer',
    icon: SOLID_TOOL_ICONS.rect,
  };
}

function shapeIcon(kind: string): SolidIconName {
  switch (kind) {
    case 'ellipse':
    case 'circle':
      return SOLID_TOOL_ICONS.ellipse;
    case 'line':
      return SOLID_TOOL_ICONS.line;
    case 'polygon':
      return SOLID_TOOL_ICONS.polygon;
    case 'star':
      return SOLID_TOOL_ICONS.star;
    case 'arrow':
      return SOLID_TOOL_ICONS.arrow;
    case 'path':
      return 'Pen';
    default:
      return SOLID_TOOL_ICONS.rect;
  }
}

function shapeLabel(kind: string): string {
  switch (kind) {
    case 'rect':
      return 'rectangle';
    case 'ellipse':
    case 'circle':
      return 'ellipse';
    case 'line':
      return 'line';
    case 'polygon':
      return 'polygon';
    case 'star':
      return 'star';
    case 'arrow':
      return 'arrow';
    case 'path':
      return 'path';
    default:
      return kind;
  }
}

const COLOR_LABELS: Record<Exclude<LayerColor, null>, string> = {
  red: 'red',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  gray: 'gray',
};

export function layerColorLabel(color: LayerColor): string | null {
  return color ? `${COLOR_LABELS[color]} layer label` : null;
}

export function maskTypeLabel(mask: SceneNode['mask']): string | null {
  if (!mask) return null;
  const source = mask.rasterMask
    ? 'raster'
    : mask.vectorMask
      ? 'vector'
      : mask.matteSource
        ? 'live'
        : 'layer';
  const mode = mask.type === 'clip' ? 'clipping' : mask.type;
  const disabled = mask.visible === false ? ', disabled' : '';
  const inverted = mask.inverted ? ', inverted' : '';
  return `${source} ${mode} mask${disabled}${inverted}`;
}

export function layerAccessibleDescription(
  node: SceneNode,
  presentation: LayerPresentation,
  options: {
    maskRole?: 'source' | 'content';
    detail?: string;
  },
): string {
  const states = [presentation.category === 'adjustment' ? 'Adjustment Layer' : presentation.label];
  if (options.detail) states.push(options.detail);
  if (node.layerColor) states.push(layerColorLabel(node.layerColor)!);
  const mask = maskTypeLabel(node.mask);
  if (mask) states.push(mask);
  if (options.maskRole === 'source') states.push('clipping mask source');
  if (options.maskRole === 'content') states.push('clipped content');
  return `${node.name}, ${states.join(', ')}`;
}

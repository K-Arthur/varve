import { HELP_CONTENT as HELP_PACKAGE_CONTENT } from '@varve/help';

export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  category: string;
  related: string[];
}

/**
 * Local tool/panel/export help articles. Merged with the shared
 * @varve/help package so all help entry points (F1, What's This,
 * ContextualHelp) search the same corpus.
 */
const LOCAL_HELP_CONTENT: Record<string, HelpArticle> = {
  'tool:select': {
    id: 'tool:select',
    title: 'Select Tool (V)',
    summary: 'Select, move, and resize objects on the canvas.',
    body: 'Click on any object to select it. Drag to move. Drag handles to resize. Hold Shift to add to selection. Double-click to enter a group or edit path nodes.',
    keywords: ['select', 'move', 'drag', 'resize', 'transform', 'v'],
    category: 'Tools',
    related: ['tool:rect', 'panel:layers'],
  },
  'tool:rect': {
    id: 'tool:rect',
    title: 'Rectangle Tool (R)',
    summary: 'Draw rectangles and squares.',
    body: 'Click and drag on the canvas to draw a rectangle. Hold Shift to constrain to a square. Hold Alt/Option to draw from center. Change corner radius in the Inspector panel.',
    keywords: ['rectangle', 'square', 'shape', 'draw', 'r'],
    category: 'Tools',
    related: ['tool:ellipse', 'tool:select'],
  },
  'tool:ellipse': {
    id: 'tool:ellipse',
    title: 'Ellipse Tool (E)',
    summary: 'Draw ellipses and circles.',
    body: 'Click and drag to draw an ellipse. Hold Shift for a perfect circle. Hold Alt/Option to draw from center.',
    keywords: ['ellipse', 'circle', 'oval', 'shape', 'draw', 'e'],
    category: 'Tools',
    related: ['tool:rect', 'tool:select'],
  },
  'tool:polygon': {
    id: 'tool:polygon',
    title: 'Polygon Tool',
    summary: 'Draw regular polygons with configurable sides.',
    body: 'Click and drag to draw a polygon. Change the number of sides in the Inspector. Hold Shift to constrain rotation.',
    keywords: ['polygon', 'shape', 'sides', 'draw'],
    category: 'Tools',
    related: ['tool:star', 'tool:rect'],
  },
  'tool:star': {
    id: 'tool:star',
    title: 'Star Tool',
    summary: 'Draw stars with configurable points and radius.',
    body: 'Click and drag to draw a star. Adjust the number of points and inner radius in the Inspector.',
    keywords: ['star', 'shape', 'points', 'draw'],
    category: 'Tools',
    related: ['tool:polygon', 'tool:rect'],
  },
  'tool:line': {
    id: 'tool:line',
    title: 'Line Tool (L)',
    summary: 'Draw straight lines.',
    body: 'Click and drag to draw a line. Hold Shift to constrain to 45-degree angles. Change stroke weight and color in the Inspector.',
    keywords: ['line', 'stroke', 'draw', 'l'],
    category: 'Tools',
    related: ['tool:arrow', 'tool:pen'],
  },
  'tool:arrow': {
    id: 'tool:arrow',
    title: 'Arrow Tool',
    summary: 'Draw arrows with configurable arrowheads.',
    body: 'Click and drag to draw an arrow. Arrowheads are added automatically at the end point. Customize arrowhead style and size in the Inspector.',
    keywords: ['arrow', 'line', 'pointer', 'connector'],
    category: 'Tools',
    related: ['tool:line', 'tool:pen'],
  },
  'tool:hand': {
    id: 'tool:hand',
    title: 'Hand Tool (H)',
    summary: 'Pan the canvas viewport.',
    body: 'Click and drag to pan around the canvas. Hold the spacebar temporariliy activates the Hand tool from any other tool. Use the scroll wheel to scroll vertically and Shift+scroll to scroll horizontally.',
    keywords: ['hand', 'pan', 'scroll', 'viewport', 'navigate', 'h'],
    category: 'Tools',
    related: ['tool:zoom', 'tool:select'],
  },
  'tool:zoom': {
    id: 'tool:zoom',
    title: 'Zoom Tool (Z)',
    summary: 'Zoom in and out of the canvas.',
    body: 'Click to zoom in. Alt+click to zoom out. Drag to create a marquee selection that fills the viewport. Ctrl+0 resets zoom to 100%.',
    keywords: ['zoom', 'magnify', 'view', 'z'],
    category: 'Tools',
    related: ['tool:hand', 'shortcuts'],
  },
  'tool:slice': {
    id: 'tool:slice',
    title: 'Export Region Tool (K)',
    summary: 'Mark a rectangular area to export.',
    body: 'Click and drag to mark an area for export. An export region paints nothing and never adopts the artwork it covers - it only names a rectangle the export dialog can render. To cut artwork into pieces, use the Knife tool (N).',
    keywords: ['slice', 'export', 'region', 'crop', 'k'],
    category: 'Tools',
    related: ['tool:knife', 'export'],
  },
  'tool:knife': {
    id: 'tool:knife',
    title: 'Knife Tool (N)',
    summary: 'Cut vector objects into independently editable pieces.',
    body: 'Drag a cut across selected objects, or across whatever the cut crosses when nothing is selected. The cut must pass all the way through an object to divide it. Hold Shift to constrain the cut to 45 degrees, Escape to abandon it. The whole cut is one undo step. Live text and compound paths with holes are refused rather than corrupted.',
    keywords: ['knife', 'slice', 'split', 'cut', 'divide', 'vector', 'n'],
    category: 'Tools',
    related: ['tool:slice', 'tool:pen'],
  },
  'tool:eyedropper': {
    id: 'tool:eyedropper',
    title: 'Eyedropper Tool (I)',
    summary: 'Sample colors from the canvas.',
    body: "Click on any pixel in the canvas to sample its color. The sampled color is applied to the selected object's fill. Hold Alt to sample to stroke instead.",
    keywords: ['eyedropper', 'color', 'pick', 'sample', 'i'],
    category: 'Tools',
    related: ['tool:select', 'panel:inspector'],
  },
  'tool:scale': {
    id: 'tool:scale',
    title: 'Scale Tool',
    summary: 'Scale objects by dragging for precise resizing.',
    body: 'Select an object, then drag from the center or edge to scale it uniformly or non-uniformly. The Inspector shows precise dimensions during scaling.',
    keywords: ['scale', 'resize', 'transform', 's'],
    category: 'Tools',
    related: ['tool:select', 'tool:inspect'],
  },
  'tool:inspect': {
    id: 'tool:inspect',
    title: 'Inspect Tool',
    summary: 'Measure distances and inspect element properties.',
    body: 'Hover over objects to see their dimensions and position. Click to lock a measurement. Distance and angle readouts help with precise layout.',
    keywords: ['inspect', 'measure', 'distance', 'dimensions', 'info'],
    category: 'Tools',
    related: ['tool:select', 'panel:inspector'],
  },
  'tool:cloneStamp': {
    id: 'tool:cloneStamp',
    title: 'Clone Stamp Tool',
    summary: 'Copy pixels from one area to another.',
    body: 'Alt+click to set a source point, then paint to clone pixels from the source to the destination area. Useful for removing imperfections or duplicating texture.',
    keywords: ['clone', 'stamp', 'copy', 'pixels', 'retouch', 'j'],
    category: 'Tools',
    related: ['tool:healBrush', 'tool:spotHeal'],
  },
  'tool:healBrush': {
    id: 'tool:healBrush',
    title: 'Healing Brush Tool',
    summary: 'Intelligently repair blemishes and imperfections.',
    body: 'Alt+click to set a source area, then paint over the area to repair. The healing brush blends source texture with destination lighting for seamless results.',
    keywords: ['heal', 'brush', 'repair', 'blemish', 'retouch'],
    category: 'Tools',
    related: ['tool:cloneStamp', 'tool:spotHeal'],
  },
  'tool:spotHeal': {
    id: 'tool:spotHeal',
    title: 'Spot Healing Tool',
    summary: 'Quickly remove small blemishes and spots.',
    body: 'Click on a spot or blemish to remove it. The spot healing tool samples surrounding pixels and blends them seamlessly. Best for small, isolated imperfections.',
    keywords: ['spot', 'heal', 'blemish', 'remove', 'retouch'],
    category: 'Tools',
    related: ['tool:healBrush', 'tool:cloneStamp'],
  },
  'tool:patch': {
    id: 'tool:patch',
    title: 'Patch Tool',
    summary: 'Replace a selected area with sampled texture.',
    body: 'Drag to select an area to patch. Then drag the selection to a source area with the texture you want. The patch tool blends the source texture into the target region.',
    keywords: ['patch', 'replace', 'texture', 'area', 'retouch'],
    category: 'Tools',
    related: ['tool:healBrush', 'tool:cloneStamp'],
  },
  'tool:nodeEdit': {
    id: 'tool:nodeEdit',
    title: 'Node Edit Tool',
    summary: 'Edit anchor points and bezier handles of paths.',
    body: 'Double-click a path to enter node edit mode. Click and drag anchors to reposition. Drag bezier handles to adjust curves. Use the toolbar to convert between corner and smooth points.',
    keywords: ['node', 'anchor', 'bezier', 'handle', 'path', 'edit'],
    category: 'Tools',
    related: ['tool:pen', 'tool:pencil'],
  },
  'tool:pen': {
    id: 'tool:pen',
    title: 'Pen Tool (P)',
    summary: 'Draw bezier curves and custom paths.',
    body: 'Click to create straight segments. Click and drag to create curved segments with bezier handles. Close a path by clicking the first point. Edit paths with the Node Edit tool.',
    keywords: ['pen', 'bezier', 'path', 'curve', 'vector', 'p'],
    category: 'Tools',
    related: ['tool:nodeEdit', 'tool:pencil'],
  },
  'tool:pencil': {
    id: 'tool:pencil',
    title: 'Pencil Tool (Shift+P)',
    summary: 'Freehand draw smooth paths.',
    body: 'Click and drag to draw freeform paths. The pencil automatically smooths your strokes using Ramer-Douglas-Peucker simplification. Edit the result with the Node Edit tool.',
    keywords: ['pencil', 'freehand', 'draw', 'sketch', 'shift+p'],
    category: 'Tools',
    related: ['tool:pen', 'tool:nodeEdit'],
  },
  'tool:text': {
    id: 'tool:text',
    title: 'Text Tool (T)',
    summary: 'Add and edit text.',
    body: 'Click on the canvas to create a text box. Type your text. Edit font family, size, weight, alignment, and color in the Inspector. Double-click any text to edit it inline.',
    keywords: ['text', 'type', 'font', 'typography', 't'],
    category: 'Tools',
    related: ['panel:inspector', 'export'],
  },
  'tool:frame': {
    id: 'tool:frame',
    title: 'Frame Tool (F)',
    summary: 'Create containers for organizing content.',
    body: 'Click and drag to draw a frame. Frames can contain other shapes and clip their contents. Use frames to create screens, artboards, and component containers.',
    keywords: ['frame', 'container', 'artboard', 'screen', 'f'],
    category: 'Tools',
    related: ['tool:rect', 'tool:select'],
  },
  'panel:layers': {
    id: 'panel:layers',
    title: 'Layers Panel',
    summary: 'View and manage the layer hierarchy of your document.',
    body: 'The Layers panel shows all objects in your document as a tree. Drag to reorder. Right-click for options. Use the search bar to filter layers. Click the eye icon to hide layers.',
    keywords: ['layers', 'tree', 'hierarchy', 'order', 'z-index'],
    category: 'Panels',
    related: ['tool:select', 'panel:inspector'],
  },
  'panel:inspector': {
    id: 'panel:inspector',
    title: 'Inspector Panel',
    summary: 'Edit properties of selected objects.',
    body: 'The Inspector shows editable properties for the selected object: position, size, rotation, fills, strokes, effects, and more. Multi-select shows alignment and distribution tools.',
    keywords: ['inspector', 'properties', 'edit', 'fill', 'stroke', 'transform'],
    category: 'Panels',
    related: ['tool:select', 'panel:layers'],
  },
  'panel:timeline': {
    id: 'panel:timeline',
    title: 'Timeline Panel',
    summary: 'Create animations and interactive prototypes.',
    body: 'The Timeline panel lets you create keyframe animations, set transitions between screens, and build interactive prototypes. Add motion to your designs with timeline-based animation.',
    keywords: ['timeline', 'animation', 'motion', 'keyframe', 'prototype'],
    category: 'Panels',
    related: ['tool:frame', 'export'],
  },
  'panel:library': {
    id: 'panel:library',
    title: 'Library Panel',
    summary: 'Access shared components and design resources.',
    body: 'The Library panel contains reusable components, styles, and assets. Drag components from the library onto the canvas to instantiate them. Changes to library components sync across all instances.',
    keywords: ['library', 'components', 'assets', 'reuse', 'sync'],
    category: 'Panels',
    related: ['tool:frame', 'panel:layers'],
  },
  'tool:booleanUnion': {
    id: 'tool:booleanUnion',
    title: 'Boolean Union (Ctrl+Alt+U)',
    summary: 'Combine selected shapes into a single shape.',
    body: 'Union merges overlapping shapes into one combined shape. The resulting shape takes the fill of the topmost selected shape.',
    keywords: ['boolean', 'union', 'combine', 'merge', 'shape'],
    category: 'Tools',
    related: ['tool:booleanSubtract', 'tool:booleanIntersect'],
  },
  'tool:booleanSubtract': {
    id: 'tool:booleanSubtract',
    title: 'Boolean Subtract (Ctrl+Alt+S)',
    summary: 'Cut away overlapping areas of shapes.',
    body: 'Subtract removes the area of the topmost shape from the shapes below it. Useful for creating cutouts and negative space effects.',
    keywords: ['boolean', 'subtract', 'cut', 'difference', 'shape'],
    category: 'Tools',
    related: ['tool:booleanUnion', 'tool:booleanIntersect'],
  },
  'tool:booleanIntersect': {
    id: 'tool:booleanIntersect',
    title: 'Boolean Intersect (Ctrl+Alt+I)',
    summary: 'Keep only the overlapping area of shapes.',
    body: 'Intersect keeps only the area where all selected shapes overlap. Everything outside the overlap is removed.',
    keywords: ['boolean', 'intersect', 'overlap', 'common', 'shape'],
    category: 'Tools',
    related: ['tool:booleanUnion', 'tool:booleanSubtract'],
  },
  'tool:booleanExclude': {
    id: 'tool:booleanExclude',
    title: 'Boolean Exclude (Ctrl+Alt+X)',
    summary: 'Remove the overlapping area between shapes.',
    body: 'Exclude removes the area where shapes overlap, keeping only the non-overlapping portions. Also known as XOR.',
    keywords: ['boolean', 'exclude', 'xor', 'difference', 'shape'],
    category: 'Tools',
    related: ['tool:booleanUnion', 'tool:booleanSubtract'],
  },
  export: {
    id: 'export',
    title: 'Exporting Your Design',
    summary: 'Export your work in multiple formats.',
    body: 'Use File > Export or press Ctrl+E to open the Export dialog. Choose from PNG, SVG, PDF, WebP, and React/Flutter/SwiftUI code export. Each format has configurable options.',
    keywords: ['export', 'png', 'svg', 'pdf', 'code', 'save', 'share'],
    category: 'Export',
    related: ['shortcuts', 'tool:select'],
  },
  shortcuts: {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    summary: 'Speed up your workflow with keyboard shortcuts.',
    body: 'Press Ctrl+/ (Cmd+/) to open the keyboard shortcuts palette, where you can view and remap all shortcuts. Common shortcuts: V (Select), R (Rectangle), T (Text), Ctrl+Z (Undo), Ctrl+G (Group).',
    keywords: ['shortcuts', 'keys', 'keyboard', 'hotkeys', 'speed'],
    category: 'General',
    related: ['export', 'tool:select'],
  },
};

/**
 * Merged help corpus: local tool/panel articles + the shared @varve/help
 * package (Getting Started, FAQ, Troubleshooting, etc.).
 */
export const HELP_CONTENT: Record<string, HelpArticle> = {
  ...LOCAL_HELP_CONTENT,
  ...HELP_PACKAGE_CONTENT,
};

export function getHelpContent(id: string): HelpArticle | undefined {
  return HELP_CONTENT[id];
}

export function getHelpContext(): string | null {
  const active = document.activeElement;
  if (active) {
    const panel = active.closest('[data-panel]');
    if (panel) {
      const panelName = panel.getAttribute('data-panel');
      if (panelName && HELP_CONTENT[`panel:${panelName}`]) return `panel:${panelName}`;
    }
  }
  return null;
}

export function searchHelpContent(query: string): HelpArticle[] {
  const lower = query.toLowerCase();
  return Object.values(HELP_CONTENT).filter(
    (a) =>
      a.title.toLowerCase().includes(lower) ||
      a.summary.toLowerCase().includes(lower) ||
      a.keywords.some((k) => k.includes(lower)),
  );
}

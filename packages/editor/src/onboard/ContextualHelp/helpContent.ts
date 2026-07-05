export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  category: string;
  related: string[];
}

export const HELP_CONTENT: Record<string, HelpArticle> = {
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
    title: 'Pencil Tool (N)',
    summary: 'Freehand draw smooth paths.',
    body: 'Click and drag to draw freeform paths. The pencil automatically smooths your strokes using Ramer-Douglas-Peucker simplification. Edit the result with the Node Edit tool.',
    keywords: ['pencil', 'freehand', 'draw', 'sketch', 'n'],
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
    body: 'Press Ctrl+Shift+P to open the Shortcut Palette, where you can view and remap all shortcuts. Common shortcuts: V (Select), R (Rectangle), T (Text), Ctrl+Z (Undo), Ctrl+G (Group).',
    keywords: ['shortcuts', 'keys', 'keyboard', 'hotkeys', 'speed'],
    category: 'General',
    related: ['export', 'tool:select'],
  },
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

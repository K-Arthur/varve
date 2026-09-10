/**
 * Did You Know? — contextual tip definitions.
 *
 * Each tip has a condition that evaluates the action tracker to decide
 * if the tip is relevant to the user's current workflow.
 */

export type TipCategory =
  | 'shortcuts'
  | 'editing'
  | 'panels'
  | 'layers'
  | 'text'
  | 'color'
  | 'export'
  | 'prototype'
  | 'grids';

export interface Tip {
  id: string;
  title: string;
  body: string;
  category: TipCategory;
  /** Returns true if this tip should be shown based on action tracker data */
  condition?: (getCount: (actionId: string, windowMs?: number) => number) => boolean;
}

export const TIPS: Tip[] = [
  {
    id: 'shortcut-select',
    title: 'Quick tool switching',
    body: 'Press V to switch to the Select tool, R for Rectangle, T for Text. Keyboard shortcuts speed up your workflow significantly.',
    category: 'shortcuts',
    condition: (getCount) =>
      getCount('tool:select', 300000) > 10 && getCount('shortcut:', 300000) < 3,
  },
  {
    id: 'shortcut-shift-constrain',
    title: 'Constrain proportions',
    body: 'Hold Shift while drawing a shape to constrain its proportions — perfect circles and squares are just a keystroke away.',
    category: 'editing',
    condition: (getCount) =>
      getCount('tool:rect', 300000) > 5 || getCount('tool:ellipse', 300000) > 5,
  },
  {
    id: 'layer-drag',
    title: 'Reorder layers',
    body: 'Drag layers in the Layers panel to change their stacking order. Layers at the top of the list appear in front.',
    category: 'layers',
    condition: (getCount) =>
      getCount('op:createNode', 600000) > 2 && getCount('menu:bringFront', 600000) < 1,
  },
  {
    id: 'text-edit',
    title: 'Inline text editing',
    body: 'Double-click any text object to edit its content directly on the canvas. No need to switch to the Inspector.',
    category: 'text',
    condition: (getCount) => getCount('tool:text', 600000) > 0,
  },
  {
    id: 'panel-toggle',
    title: 'Toggle panels',
    body: 'Press Ctrl+B to toggle the left panel and Ctrl+Shift+B to toggle the right panel. More space for your canvas.',
    category: 'panels',
    condition: () => true,
  },
  {
    id: 'color-picker',
    title: 'Quick color changes',
    body: 'Click the color swatch in the Inspector to open the color picker. Use the eyedropper to sample colors from your design.',
    category: 'color',
    condition: (getCount) => getCount('tool:select', 600000) > 10,
  },
  {
    id: 'shortcut-duplicate',
    title: 'Duplicate fast',
    body: 'Select an object and press Ctrl+D to duplicate it instantly. The duplicate appears offset from the original.',
    category: 'shortcuts',
    condition: (getCount) =>
      getCount('op:createNode', 600000) > 5 && getCount('shortcut:', 600000) < 5,
  },
  {
    id: 'shortcut-undo',
    title: 'Undo and redo',
    body: 'Press Ctrl+Z to undo your last action. Press Ctrl+Shift+Z to redo. Varve supports unlimited undo history.',
    category: 'shortcuts',
    condition: () => true,
  },
  {
    id: 'export-png',
    title: 'Export your work',
    body: 'Press Ctrl+E to open the Export dialog. Export as PNG for web, SVG for scalability, or PDF for print.',
    category: 'export',
    condition: (getCount) => getCount('op:createNode', 600000) > 5,
  },
  {
    id: 'prototype-hint',
    title: 'Create prototypes',
    body: 'Connect frames using the Prototype tab in the Inspector. Click a frame, then drag the arrow to another frame to create an interaction.',
    category: 'prototype',
    condition: (getCount) => getCount('tool:frame', 600000) > 2,
  },
  {
    id: 'grid-guides',
    title: 'Layout guides',
    body: 'Drag from the rulers at the top and left of the canvas to create layout guides. Guides help you align objects precisely.',
    category: 'grids',
    condition: (getCount) => getCount('tool:frame', 600000) > 2,
  },
  {
    id: 'shortcut-group',
    title: 'Group objects',
    body: 'Select multiple objects and press Ctrl+G to group them. Groups move and transform as a unit. Press Ctrl+Shift+G to ungroup.',
    category: 'shortcuts',
    condition: (getCount) => getCount('op:createNode', 600000) > 3,
  },
  {
    id: 'shortcut-zoom',
    title: 'Zoom controls',
    body: 'Use Ctrl++ and Ctrl+- to zoom in and out. Ctrl+0 fits everything in the viewport. The scroll wheel also zooms.',
    category: 'shortcuts',
    condition: () => true,
  },
  {
    id: 'layer-naming',
    title: 'Rename layers',
    body: 'Double-click a layer name in the Layers panel to rename it. Good names make your design easier to navigate.',
    category: 'layers',
    condition: (getCount) => getCount('op:createNode', 600000) > 5,
  },
  {
    id: 'fill-opacity',
    title: 'Transparency',
    body: 'Adjust the opacity slider in the Inspector to make objects transparent. Combine with blend modes for advanced compositing.',
    category: 'color',
    condition: (getCount) => getCount('menu:fill', 600000) > 3,
  },
  {
    id: 'text-format',
    title: 'Text formatting',
    body: 'The Floating Text Bar appears when you select a text object. Use it to quickly change font, size, weight, and alignment.',
    category: 'text',
    condition: (getCount) => getCount('tool:text', 600000) > 2,
  },
  {
    id: 'layer-visibility',
    title: 'Hide layers',
    body: 'Click the eye icon next to a layer in the Layers panel to hide it. Hidden layers do not appear in exports or prototypes.',
    category: 'layers',
    condition: (getCount) => getCount('op:createNode', 600000) > 4,
  },
  {
    id: 'snap-toggle',
    title: 'Snap alignment',
    body: 'Press the comma key (,) to toggle snapping on and off. Snapping helps align objects to each other and to the grid.',
    category: 'editing',
    condition: () => true,
  },
  {
    id: 'help-f1',
    title: 'Contextual help',
    body: 'Press F1 to open contextual help for the currently active tool or panel. Press Shift+F1 to enter "What\'s This?" mode.',
    category: 'panels',
    condition: () => true,
  },
  {
    id: 'shortcut-align',
    title: 'Align and distribute',
    body: 'Select multiple objects and use the Align tools in the Inspector to arrange them evenly. Distribute makes spacing between objects equal.',
    category: 'editing',
    condition: (getCount) =>
      getCount('tool:select', 600000) > 8 && getCount('menu:align', 600000) < 2,
  },
];

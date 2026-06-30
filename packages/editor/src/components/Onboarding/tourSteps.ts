export interface TourStep {
  id: string;
  /** CSS selector for the element to spotlight. Empty string for no spotlight (welcome/final). */
  target: string;
  title: string;
  description: string;
  /** Where to position the tooltip relative to the target. */
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Optional offset to adjust spotlight position. */
  offset?: { x?: number; y?: number };
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'toolbar',
    target: '[class*="floating-toolbar"], [class*="editor-toolbar"]',
    title: 'Drawing tools',
    description:
      'Select a drawing tool from the toolbar. Click and drag on the canvas to create shapes like rectangles, ellipses, lines, and more.',
    placement: 'bottom',
  },
  {
    id: 'canvas',
    target: '[class*="canvas-area"], [class*="editor-canvas"]',
    title: 'Canvas',
    description:
      'Click and drag to create shapes on the canvas. Use the scroll wheel to zoom, and middle-click or spacebar+drag to pan around.',
    placement: 'top',
  },
  {
    id: 'inspector',
    target: '[class*="editor__inspector-panel"], [class*="inspector"]',
    title: 'Inspector panel',
    description:
      'Edit properties of selected shapes in the inspector panel. Change position, size, fill color, opacity, and more.',
    placement: 'left',
  },
  {
    id: 'export',
    target: '[class*="menubar"], [class*="editor-menubar"]',
    title: 'Export & code',
    description:
      'Export your design as SVG or React code. Use the File menu to export, or switch to Inspect mode to measure and inspect elements.',
    placement: 'bottom',
  },
];

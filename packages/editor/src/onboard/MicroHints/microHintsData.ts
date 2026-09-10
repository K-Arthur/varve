/**
 * Contextual micro-hint definitions.
 *
 * Each hint is shown once (tracked via `dismissedMicroHints` in the
 * onboarding store) when the user first interacts with a tool or action.
 * Hints are short, actionable, and disappear automatically.
 */

export interface MicroHint {
  id: string;
  title: string;
  body: string;
  category: 'tools' | 'editing' | 'canvas' | 'text';
  /** How long the hint stays visible (ms). 0 = until user interacts. */
  duration: number;
  /** Resolved at runtime from the canonical shortcut registry; never hardcoded. */
  shortcut?: string;
}

export const MICRO_HINTS: MicroHint[] = [
  {
    id: 'rect.first-use',
    title: 'Rectangle',
    body: 'Click and drag to draw. Hold Shift for a square.',
    category: 'tools',
    duration: 5000,
  },
  {
    id: 'ellipse.first-use',
    title: 'Ellipse',
    body: 'Click and drag to draw. Hold Shift for a circle.',
    category: 'tools',
    duration: 5000,
  },
  {
    id: 'line.first-use',
    title: 'Line',
    body: 'Click and drag to draw. Hold Shift for 45-degree angles.',
    category: 'tools',
    duration: 5000,
  },
  {
    id: 'text.first-use',
    title: 'Text',
    body: 'Click to place text. Drag to create a text box.',
    category: 'text',
    duration: 5000,
  },
  {
    id: 'frame.first-use',
    title: 'Frame',
    body: 'Drag to create a frame. Frames organize your design.',
    category: 'tools',
    duration: 5000,
  },
  {
    id: 'pen.first-use',
    title: 'Pen',
    body: 'Click to place points. Drag for curves. Enter to finish.',
    category: 'tools',
    duration: 6000,
  },
  {
    id: 'line.first-path',
    title: 'Line',
    body: 'Click to place points. Enter to finish the path.',
    category: 'tools',
    duration: 5000,
  },
  {
    id: 'select.multi',
    title: 'Multi-select',
    body: 'Hold Shift and click to add or remove from selection.',
    category: 'editing',
    duration: 4000,
  },
];

/** Get the hint definition for a tool ID. */
export function getHintForTool(toolId: string): MicroHint | undefined {
  return MICRO_HINTS.find((h) => h.id === `${toolId}.first-use`);
}

/** Get the multi-select hint. */
export function getMultiSelectHint(): MicroHint {
  return MICRO_HINTS.find((h) => h.id === 'select.multi')!;
}

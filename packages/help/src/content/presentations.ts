import type { HelpArticle } from './helpTypes';

export const PRESENTATIONS: Record<string, HelpArticle> = {
  'presentations:authoring': {
    id: 'presentations:authoring',
    title: 'Presentation Authoring in Design',
    summary: 'Create an ordered deck from editable frames and preview or export it locally.',
    body: 'Create a new presentation from New in the Home screen, or select existing frames and choose Create Presentation from Selected Frames from the command palette or File menu. Review the slide order before creating the deck. In Design, open the Slides tab beside Layers. Deck order is independent of canvas position and paint order. Use Earlier, Later, or Move to position to reorder without dragging. Slide titles, sections, skip state, multi-slide actions, and private speaker notes are managed in this panel. Choose Edit slide to focus the corresponding frame on the normal canvas; Return to Slides restores the previous selection. Removing a slide removes only its deck reference and leaves its artwork on the canvas. Present opens a top-layer audience view with Previous, Next, keyboard navigation, and Exit. Notes are never shown in that view. Export the whole deck or selected slide references to a compressed raster PDF or ordered PNG archive. PDF pages keep each frame’s dimensions and appearance, but PDF text and vectors are not editable, text is not searchable, and the file has no tagged accessibility structure. Skipped and hidden slides, notes, and artwork outside the deck are excluded. Missing included frames block export and keep their title and notes available for repair. Check slides runs an advisory pass for missing artwork, placeholder-looking text, small type, transformed off-slide content, unavailable fonts and image assets, low contrast when solid text and background colors are known, and missing slide alt descriptions. Contrast checks skip ambiguous backgrounds; only missing included artwork blocks delivery. Seven native geometry sources cover title/section, body, image/text, comparison, evidence, process, and conclusion. They are editable on the Presentation Layouts Design Canvas and use the bundled font without external stock assets. Formatting inheritance, linked themes, and detailed readability analysis remain in development. These authoring and delivery paths are available in the current source build, not a published release.',
    keywords: [
      'presentation',
      'slides',
      'deck',
      'speaker notes',
      'PDF',
      'PNG sequence',
      'audience preview',
      'slide order',
      'preflight',
      'accessibility',
    ],
    category: 'Getting Started',
    related: ['getting-started:workspaces', 'export:overview'],
  },
};

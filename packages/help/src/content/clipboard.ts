import type { HelpArticle } from './helpTypes';

export const CLIPBOARD: Record<string, HelpArticle> = {
  'clipboard:reliable-transfer': {
    id: 'clipboard:reliable-transfer',
    title: 'Copy, Cut, and Paste safely',
    summary:
      'Move editable layers, SVG, images, and text while keeping ownership and fallback behavior clear.',
    body: 'Copy and Cut use a validated Varve fragment when the canvas owns the gesture. Cut keeps the original layers if an editable clipboard write is unavailable. Paste reads the initiating event or the current clipboard representations, allocates fresh identities, and selects the roots that actually arrived. Plain text becomes editable canvas text when the canvas owns the paste; native text fields keep their browser caret and IME behavior. A bounded SVG subset and raster image representations use the normal import pipeline. Components, styles, variables, motion data, and private Figma clipboard formats are not promised. Figma Copy as SVG is the documented interoperability route. If an import is partial or fails, open Import Results for the per-item warning and use the suggested fallback.',
    keywords: [
      'clipboard',
      'copy',
      'cut',
      'paste',
      'svg',
      'image',
      'text',
      'figma',
      'import',
      'fallback',
    ],
    category: 'FAQ',
    related: ['faq:text', 'faq:undo', 'getting-started:keys'],
  },
};

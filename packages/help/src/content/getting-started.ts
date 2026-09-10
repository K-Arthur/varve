import type { HelpArticle } from './helpTypes';

export const GETTING_STARTED: Record<string, HelpArticle> = {
  'getting-started:overview': {
    id: 'getting-started:overview',
    title: 'What is Varve?',
    summary: 'An overview of the local-first, cross-platform design suite.',
    body: 'Varve is a local-first, cross-platform design suite for creating user interfaces, prototypes, illustrations, and print designs. Unlike cloud-only tools, Varve runs natively on your machine with a Rust-powered engine for high performance. Your data stays on your device — no mandatory cloud sync, no account required. Varve supports vector editing, raster image manipulation, typography, animation, prototyping, and print production in a single application. The editor provides a canvas-based workspace with layers, inspector panels, timeline animation, and prototype preview.',
    keywords: ['varve', 'overview', 'design', 'local-first', 'cross-platform', 'introduction'],
    category: 'Getting Started',
    related: ['getting-started:creating', 'getting-started:interface'],
  },
  'getting-started:creating': {
    id: 'getting-started:creating',
    title: 'Creating a Document',
    summary: 'How to create new documents and choose the right settings.',
    body: 'To create a new document, go to File > New or press Ctrl+N. The New File dialog gives you several options: Blank canvas creates an empty document where you can start designing immediately. Print documents (A4, A3, Letter) set up the canvas for print production with CMYK color mode and bleed guides. You can also choose from frame presets for phone, tablet, desktop, and social media sizes after creating a blank document. Set custom dimensions, units (px, mm, cm, in), and color mode before creating. New documents are automatically named "Untitled" and saved to your drafts.',
    keywords: ['new', 'document', 'create', 'file', 'canvas', 'blank'],
    category: 'Getting Started',
    related: ['getting-started:interface', 'getting-started:saving', 'faq:export'],
  },
  'getting-started:interface': {
    id: 'getting-started:interface',
    title: 'The Editor Interface',
    summary: 'Overview of the toolbar, canvas, panels, and menubar.',
    body: 'The Varve editor is organized into several areas: The Menubar at the top provides file operations, editing commands, view options, and help. The Toolbar (floating) contains drawing and selection tools. The Canvas is the main work area where you create and manipulate designs. The Layers Panel (left sidebar) shows the hierarchy of all objects in your document. The Inspector Panel (right sidebar) displays editable properties for the selected object. The Status Bar at the bottom shows zoom level, canvas mode, and toggle controls. Page navigation appears below the canvas for multi-page documents.',
    keywords: ['interface', 'layout', 'editor', 'canvas', 'toolbar', 'panels', 'menubar'],
    category: 'Getting Started',
    related: [
      'getting-started:overview',
      'getting-started:keys',
      'panel:layers',
      'panel:inspector',
    ],
  },
  'getting-started:saving': {
    id: 'getting-started:saving',
    title: 'Saving and Opening',
    summary: 'Auto-save, recovery, and file management.',
    body: 'Varve automatically saves your work as you design. Auto-save creates recovery points that can be restored if the application closes unexpectedly. To manually save, press Ctrl+S or go to File > Save. Use Save As (Ctrl+Shift+S) to create a copy with a different name or location. Varve saves documents in its native JSON format (.varve). Opening a file: press Ctrl+O or go to File > Open to load a saved document. The Home screen lists your recent documents for quick access. Recovery sessions appear automatically after a crash, offering to restore your work with a single click.',
    keywords: ['save', 'open', 'auto-save', 'recovery', 'file', 'load', 'persist'],
    category: 'Getting Started',
    related: ['getting-started:creating', 'faq:save', 'faq:recover'],
  },
  'getting-started:keys': {
    id: 'getting-started:keys',
    title: 'Keyboard Basics',
    summary: 'Essential shortcuts for beginners to speed up your workflow.',
    body: 'Master these essential shortcuts to work faster in Varve: Tool shortcuts: V (Select), R (Rectangle), E (Ellipse), L (Line), T (Text), F (Frame), P (Pen), Shift+P (Pencil), H (Hand), Z (Zoom). Edit shortcuts: Ctrl+Z (Undo), Ctrl+Shift+Z (Redo), Ctrl+C (Copy), Ctrl+X (Cut), Ctrl+V (Paste), Ctrl+D (Duplicate), Delete (Remove). File shortcuts: Ctrl+N (New), Ctrl+O (Open), Ctrl+S (Save). View shortcuts: Ctrl+0 (Zoom to 100%), Ctrl+= (Zoom In), Ctrl+- (Zoom Out), Ctrl+B (Toggle Layers Panel). Press F1 to open the full help browser with complete shortcut reference.',
    keywords: ['shortcuts', 'keys', 'beginner', 'basics', 'essential', 'quick'],
    category: 'Getting Started',
    related: ['shortcuts', 'getting-started:overview', 'faq:shortcuts'],
  },
};

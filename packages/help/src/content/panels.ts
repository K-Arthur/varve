import type { HelpArticle } from './helpTypes';

export const PANELS: Record<string, HelpArticle> = {
  'panel:layers': {
    id: 'panel:layers',
    title: 'Layers Panel',
    summary: 'View and manage the layer hierarchy of your document.',
    body: 'The Layers panel shows all objects in your document as a tree. Click to select. Drag to reorder or reparent into containers. Right-click for context options like duplicate, group, and delete. Use the search bar to filter layers by name. Click the eye icon to toggle layer visibility. Lock layers to prevent accidental edits. Groups and frames expand to show their children. Double-click a layer name to rename it inline.',
    keywords: ['layers', 'tree', 'hierarchy', 'order', 'z-index', 'visibility'],
    category: 'Panels',
    related: ['tool:select', 'panel:inspector', 'faq:group'],
  },
  'panel:inspector': {
    id: 'panel:inspector',
    title: 'Inspector Panel',
    summary: 'Edit properties of selected objects.',
    body: 'The Inspector shows editable properties for the selected object. The Properties tab includes position, size, rotation, corner radius, fill, stroke, effects, and typography settings. The Export tab shows export options for the selected node. The Spec tab shows design specifications for handoff. The Intelligence tab provides design guidance including WCAG contrast audits, spacing harmonization, and auto-naming suggestions.',
    keywords: ['inspector', 'properties', 'edit', 'fill', 'stroke', 'transform', 'position'],
    category: 'Panels',
    related: ['tool:select', 'panel:layers', 'export:overview'],
  },
  'panel:timeline': {
    id: 'panel:timeline',
    title: 'Timeline Panel',
    summary: 'Create and manage animations and motion.',
    body: 'The Timeline panel lets you create animations by adding keyframes to object properties. Select an object and click the Add Animation button to create a new animation track. Add keyframes for position, scale, rotation, opacity, and other animatable properties. Use the playback controls to preview your animation. Adjust easing curves for natural motion. Timelines support multi-track editing for complex animations.',
    keywords: ['timeline', 'animation', 'keyframe', 'motion', 'playback', 'easing'],
    category: 'Panels',
    related: ['export:overview', 'tool:select'],
  },
  'panel:prototype': {
    id: 'panel:prototype',
    title: 'Prototype Panel',
    summary: 'Create interactive prototypes.',
    body: 'The Prototype panel lets you connect screens and create interactive flows. Define triggers (click, drag, hover, timer) and actions (navigate, overlay, animate, open URL). Set transitions between screens with animations like dissolve, slide, and push. Preview your prototype in fullscreen mode with Ctrl+Shift+P. The prototyping system supports variables, conditional logic, and responsive breakpoints.',
    keywords: ['prototype', 'interaction', 'trigger', 'action', 'transition', 'preview'],
    category: 'Panels',
    related: ['panel:timeline', 'getting-started:interface'],
  },
  'panel:intelligence': {
    id: 'panel:intelligence',
    title: 'Intelligence Panel',
    summary: 'Design guidance, audits, and automated improvements.',
    body: 'The Intelligence panel provides AI-powered design assistance directly in your workflow. The Audit tab runs WCAG contrast checks on your design and can auto-fix accessibility issues. The Spacing tab analyzes element positioning and can harmonize inconsistent spacing. The Naming tab suggests meaningful names for layers based on their content and type. Each suggestion shows a confidence level so you can decide which to apply.',
    keywords: ['intelligence', 'audit', 'wcag', 'contrast', 'spacing', 'naming', 'ai'],
    category: 'Panels',
    related: ['panel:inspector', 'tool:select', 'export:overview'],
  },
};

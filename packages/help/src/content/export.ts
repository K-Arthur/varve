import type { HelpArticle } from './helpTypes';

export const EXPORT: Record<string, HelpArticle> = {
  'export:overview': {
    id: 'export:overview',
    title: 'Export Overview',
    summary: 'Available export formats and options.',
    body: 'Strata supports exporting your designs in multiple formats for different use cases. Open the Export dialog with File > Export or Ctrl+E. You can export individual nodes, frames, or the entire document. Each format has configurable options for scale, quality, and color profile. For code export, choose from React (JSX/Tailwind), Flutter, or SwiftUI output for seamless developer handoff.',
    keywords: ['export', 'format', 'overview', 'dialog'],
    category: 'Export',
    related: ['export:png', 'export:svg', 'export:code', 'export:pdf'],
  },
  'export:png': {
    id: 'export:png',
    title: 'PNG Export',
    summary: 'Export raster images in PNG format.',
    body: 'PNG export is best for web graphics, social media images, and any use case requiring transparency. Configure resolution (1x, 2x, 3x for Retina/HiDPI), background color (transparent or solid), and which layers to include. PNG supports full alpha transparency and is widely compatible across all platforms.',
    keywords: ['png', 'raster', 'image', 'transparency', 'retina', 'hdpi'],
    category: 'Export',
    related: ['export:overview', 'export:svg'],
  },
  'export:svg': {
    id: 'export:svg',
    title: 'SVG Export',
    summary: 'Export vector graphics in SVG format.',
    body: 'SVG export produces resolution-independent vector graphics ideal for icons, illustrations, and web graphics. SVG files can be edited in any vector editor and scale perfectly at any size. Choose whether to include the full document or a specific node. SVG exports preserve fills, strokes, gradients, and text as editable vector elements.',
    keywords: ['svg', 'vector', 'scalable', 'web', 'icon'],
    category: 'Export',
    related: ['export:overview', 'export:png', 'export:code'],
  },
  'export:code': {
    id: 'export:code',
    title: 'Code Export',
    summary: 'Export designs as React, Flutter, or SwiftUI code.',
    body: 'Code export generates production-ready UI code from your designs. React export creates JSX components with Tailwind CSS classes automatically matched to your design tokens. Flutter export generates Dart code with Row, Column, and Stack layout widgets. SwiftUI export creates Swift code with HStack, VStack, and ZStack views. Each emitter preserves your design structure, spacing, colors, and typography as code.',
    keywords: ['code', 'react', 'flutter', 'swiftui', 'tailwind', 'jsx', 'dart', 'swift'],
    category: 'Export',
    related: ['export:svg', 'export:overview'],
  },
  'export:pdf': {
    id: 'export:pdf',
    title: 'PDF Export',
    summary: 'Export print-ready PDF documents.',
    body: 'PDF export produces print-ready documents for professional printing. Supports CMYK color mode with ICC profile awareness for accurate color reproduction. Configureble bleed, crop marks, registration marks, and color bars for commercial printing. Export as PDF/X-1a or PDF/X-4 for standardized print workflows. Fonts can be outlined to ensure correct rendering on any system.',
    keywords: ['pdf', 'print', 'cmyk', 'bleed', 'crop', 'pdfx', 'icc'],
    category: 'Export',
    related: ['export:overview', 'export:svg'],
  },
};

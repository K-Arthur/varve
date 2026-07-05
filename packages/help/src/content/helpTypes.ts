export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  category: string;
  related: string[];
}

export const CATEGORIES = [
  'Getting Started',
  'Tools',
  'Panels',
  'Export',
  'Shortcuts',
  'FAQ',
  'Troubleshooting',
] as const;

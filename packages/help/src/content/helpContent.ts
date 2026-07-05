import type { HelpArticle } from './helpTypes';
import { GETTING_STARTED } from './getting-started';
import { TOOLS } from './tools';
import { PANELS } from './panels';
import { EXPORT } from './export';
import { SHORTCUTS_REFERENCE } from './shortcuts';
import { FAQ } from './faq';
import { TROUBLESHOOTING } from './troubleshooting';

export const HELP_CONTENT: Record<string, HelpArticle> = {
  ...GETTING_STARTED,
  ...TOOLS,
  ...PANELS,
  ...EXPORT,
  shortcuts: SHORTCUTS_REFERENCE,
  ...FAQ,
  ...TROUBLESHOOTING,
};

export function getHelpContent(id: string): HelpArticle | undefined {
  return HELP_CONTENT[id];
}

export function searchHelpContent(query: string): HelpArticle[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [];
  return Object.values(HELP_CONTENT).filter(
    (a) =>
      a.title.toLowerCase().includes(lower) ||
      a.summary.toLowerCase().includes(lower) ||
      a.keywords.some((k) => k.toLowerCase().includes(lower)),
  );
}

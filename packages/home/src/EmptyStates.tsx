import type { SidebarSection } from '@varve/platform';
import { Button, EmptyState, SemanticIcon } from '@varve/ui';

export interface EmptyStatesProps {
  section: SidebarSection | 'search' | 'missing';
  query?: string;
  onAction: () => void;
}

const ILLUSTRATIONS: Record<string, string> = {
  recent: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><circle cx="60" cy="60" r="45" stroke="currentColor" stroke-width="2" fill="none"/><path stroke="currentColor" stroke-width="2" d="M60 35v25l15 15"/><circle cx="60" cy="60" r="3" fill="currentColor"/></svg>`,
  all: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><rect x="15" y="20" width="90" height="80" rx="8" stroke="currentColor" stroke-width="2" fill="none"/><path stroke="currentColor" stroke-width="2" d="M15 40h90M45 20v80"/><circle cx="32" cy="30" r="3" fill="currentColor"/></svg>`,
  templates: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><rect x="10" y="25" width="45" height="35" rx="4" stroke="currentColor" stroke-width="2" fill="none"/><rect x="65" y="25" width="45" height="35" rx="4" stroke="currentColor" stroke-width="2" fill="none"/><rect x="10" y="68" width="45" height="35" rx="4" stroke="currentColor" stroke-width="2" fill="none"/><rect x="65" y="68" width="45" height="35" rx="4" stroke="currentColor" stroke-width="2" fill="none"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><rect x="28" y="35" width="64" height="72" rx="6" stroke="currentColor" stroke-width="2" fill="none"/><path stroke="currentColor" stroke-width="2" d="M42 20h36l6 15H36z"/><path stroke="currentColor" stroke-width="2" d="M50 55v24M70 55v24"/></svg>`,
  project: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><rect x="15" y="25" width="90" height="75" rx="6" stroke="currentColor" stroke-width="2" fill="none"/><rect x="25" y="35" width="70" height="55" rx="4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="4 4"/><circle cx="36" cy="43" r="2" fill="currentColor"/><circle cx="45" cy="43" r="2" fill="currentColor"/></svg>`,
  search: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><circle cx="50" cy="50" r="32" stroke="currentColor" stroke-width="2" fill="none"/><path stroke="currentColor" stroke-width="3" d="M73 73l22 22" stroke-linecap="round"/><circle cx="50" cy="50" r="3" fill="currentColor"/></svg>`,
  collections: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><rect x="10" y="15" width="45" height="45" rx="6" stroke="currentColor" stroke-width="2" fill="none"/><rect x="65" y="15" width="45" height="45" rx="6" stroke="currentColor" stroke-width="2" fill="none"/><rect x="10" y="68" width="45" height="45" rx="6" stroke="currentColor" stroke-width="2" fill="none"/><rect x="65" y="68" width="45" height="45" rx="6" stroke="currentColor" stroke-width="2" fill="none"/><path stroke="currentColor" stroke-width="1.5" d="M32 37v10M28 42h8"/><circle cx="82" cy="37" r="2" fill="currentColor"/><circle cx="82" cy="48" r="2" fill="currentColor"/><circle cx="32" cy="90" r="2" fill="currentColor"/></svg>`,
  activity: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><circle cx="60" cy="40" r="20" stroke="currentColor" stroke-width="2" fill="none"/><path stroke="currentColor" stroke-width="2" d="M30 80c0-16 14-28 30-28s30 12 30 28"/><rect x="25" y="82" width="70" height="20" rx="4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>`,
  missing: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><path stroke="currentColor" stroke-width="2" d="M60 20v30M60 70v30M20 60h30M70 60h30"/><circle cx="60" cy="60" r="40" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="60" cy="60" r="8" fill="currentColor"/></svg>`,
  savedSearch: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 120"><circle cx="50" cy="50" r="32" stroke="currentColor" stroke-width="2" fill="none"/><path stroke="currentColor" stroke-width="3" d="M73 73l22 22" stroke-linecap="round"/><circle cx="50" cy="50" r="3" fill="currentColor"/><path stroke="currentColor" stroke-width="1.5" d="M42 45h16M42 55h10"/></svg>`,
};

interface CopyEntry {
  headline: string;
  description: string;
  cta: string;
}

const EMPTY_COPY: Record<string, CopyEntry> = {
  drafts: {
    headline: 'No drafts yet',
    description: "Files you start but haven't published or moved to a project will show up here.",
    cta: 'New design',
  },
  recent: {
    headline: 'Nothing here yet',
    description: 'Open a design or create something new — your recent work will show up here.',
    cta: 'Create your first design',
  },
  all: {
    headline: 'Start with a blank slate',
    description: 'No designs yet. Drop a file, import something, or begin with a fresh canvas.',
    cta: 'New design',
  },
  templates: {
    headline: 'Templates coming soon',
    description:
      'Pre-built templates are on the way. For now, start from scratch or import an existing file.',
    cta: 'Back to files',
  },
  trash: {
    headline: 'Trash is empty',
    description: 'Deleted files end up here for 30 days before being permanently removed.',
    cta: 'Browse files',
  },
  project: {
    headline: 'This project is empty',
    description: 'Add files to this project by dragging them here or creating new designs.',
    cta: 'Browse all files',
  },
  search: {
    headline: 'No results found',
    description: 'Try different keywords, check your spelling, or clear your filters.',
    cta: 'Clear search',
  },
  collections: {
    headline: 'No collections yet',
    description: 'Collections help you organize files across projects. Create one to get started.',
    cta: 'Browse all files',
  },
  activity: {
    headline: 'Quiet around here',
    description:
      'Changes to your workspace — file edits, imports, and version saves — will show up here.',
    cta: 'Browse all files',
  },
  missing: {
    headline: 'File not found',
    description:
      'This file was moved or deleted. You can remove it from your recent files or find it on your device.',
    cta: 'Remove from recents',
  },
  savedSearch: {
    headline: 'No saved searches yet',
    description: 'Save your filter configurations to quickly access them later.',
    cta: 'Browse all files',
  },
};

export function EmptyStates({ section, query, onAction }: EmptyStatesProps) {
  const svgHtml = (ILLUSTRATIONS[section] ?? ILLUSTRATIONS.recent)!;
  const copy = (EMPTY_COPY[section] ?? EMPTY_COPY.recent)!;

  const illustration = (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: static safe SVG content from constant lookup table
    <div className="empty-states__illustration" dangerouslySetInnerHTML={{ __html: svgHtml }} />
  );

  const headline: string =
    section === 'search' && query ? `No results for "${query}"` : copy.headline;

  return (
    <EmptyState
      illustration={illustration}
      headline={headline}
      description={copy.description}
      actions={
        <Button variant="primary" onClick={onAction}>
          <SemanticIcon
            name={section === 'trash' || section === 'templates' ? 'Back' : 'Add'}
            size="sm"
          />
          {copy.cta}
        </Button>
      }
    />
  );
}

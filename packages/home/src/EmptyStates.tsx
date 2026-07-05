import type { SidebarSection } from '@strata/platform';
import { Button, EmptyState, Icon } from '@strata/ui';

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
  default: { headline: '', description: '', cta: '' },
  recent: {
    headline: 'No recent files',
    description:
      'Your recently opened designs will appear here. Create a new design or open an existing one to get started.',
    cta: 'Create your first design',
  },
  all: {
    headline: 'No files yet',
    description:
      'This is where all your designs live. Start creating with a blank canvas or open a design from your computer.',
    cta: 'New design',
  },
  templates: {
    headline: 'No templates',
    description:
      'Choose from a variety of pre-made templates to jump-start your design. Templates are coming soon.',
    cta: 'Back to files',
  },
  trash: {
    headline: 'Trash is empty',
    description:
      'Deleted files will appear here. You can restore them or permanently delete them from your device.',
    cta: 'Browse files',
  },
  project: {
    headline: 'No files in this project',
    description:
      'Files assigned to this project will appear here. Drag a design here or create a new one.',
    cta: 'Browse all files',
  },
  search: {
    headline: 'No results found',
    description: 'Try different keywords or clear your filters.',
    cta: 'Clear search',
  },
  collections: {
    headline: 'No collections yet',
    description: 'Create a collection to organize files across projects.',
    cta: 'Browse all files',
  },
  activity: {
    headline: 'No recent activity',
    description: 'Activity from your workspace will appear here.',
    cta: 'Browse all files',
  },
  missing: {
    headline: 'File not found',
    description:
      'This file has been moved or deleted from your device. You can remove it from your recent files or locate it manually.',
    cta: 'Remove from recents',
  },
  savedSearch: {
    headline: 'No saved searches yet',
    description: 'Search for files and save your filter.',
    cta: 'Browse all files',
  },
};

export function EmptyStates({ section, query, onAction }: EmptyStatesProps) {
  const svgHtml = ILLUSTRATIONS[section] ?? ILLUSTRATIONS.recent;
  if (!svgHtml) throw new Error('illustration not found');
  const copy = EMPTY_COPY[section] ?? EMPTY_COPY.default;
  if (!copy) throw new Error('copy not found');

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
          <Icon
            name={section === 'trash' || section === 'templates' ? 'ArrowLeft' : 'Plus'}
            label={undefined}
          />
          {copy.cta}
        </Button>
      }
    />
  );
}

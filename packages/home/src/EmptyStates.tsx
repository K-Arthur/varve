import type { SidebarSection } from '@strata/platform';
import { Button, EmptyState, Icon } from '@strata/ui';

export interface EmptyStatesProps {
  section: SidebarSection | 'search';
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
};

export function EmptyStates({ section, query, onAction }: EmptyStatesProps) {
  const svgHtml: string = (ILLUSTRATIONS[section] ?? ILLUSTRATIONS.recent)!;
  const copy: CopyEntry = (EMPTY_COPY[section] ?? EMPTY_COPY.default)!;

  const illustration = (
    <div dangerouslySetInnerHTML={{ __html: svgHtml }} style={{ width: '8rem', height: '8rem' }} />
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

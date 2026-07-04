import type { TemplateLibrary, TemplateSource } from '@strata/platform';
import { Icon, type IconName } from '@strata/ui';
import { useMemo, useState } from 'react';
import { EmptyStates } from './EmptyStates';

export interface TemplatesGalleryProps {
  onSelect: (template: TemplateLibrary) => void;
  templates?: TemplateLibrary[];
  onSearch?: (query: string) => void;
  showSearch?: boolean;
  sourceFilters?: TemplateSource[];
}

const CATEGORY_META: Record<string, { color: string; icon: IconName }> = {
  General: { color: 'var(--color-interactive-default)', icon: 'Frame' },
  Marketing: { color: 'var(--color-accent-primary)', icon: 'Megaphone' },
  Social: { color: 'var(--color-feedback-info)', icon: 'Share2' },
  Presentation: { color: 'var(--color-feedback-warning)', icon: 'Presentation' },
  Print: { color: 'var(--color-feedback-danger)', icon: 'Printer' },
  UI: { color: 'var(--color-feedback-success)', icon: 'Layout' },
};

const SOURCE_BADGE_LABELS: Record<TemplateSource, string> = {
  builtin: 'Built-in',
  user: 'User',
  workspace: 'Workspace',
  community: 'Community',
};

export function TemplatesGallery({
  onSelect,
  templates,
  onSearch,
  showSearch = false,
  sourceFilters,
}: TemplatesGalleryProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const allTemplates = templates ?? [];

  const filtered = useMemo(() => {
    let result = allTemplates;

    if (sourceFilters && sourceFilters.length > 0) {
      result = result.filter((t) => sourceFilters.includes(t.source));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [allTemplates, sourceFilters, searchQuery]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    onSearch?.(value);
  };

  const grouped = useMemo(() => {
    const map: Record<string, TemplateLibrary[]> = {};
    for (const t of filtered) {
      if (!map[t.category]) map[t.category] = [];
      map[t.category].push(t);
    }
    return map;
  }, [filtered]);

  if (filtered.length === 0) {
    if (searchQuery.trim()) {
      return (
        <div className="templates-gallery">
          {showSearch && <SearchBar value={searchQuery} onChange={handleSearchChange} />}
          <EmptyStates
            section="search"
            query={searchQuery}
            onAction={() => handleSearchChange('')}
          />
        </div>
      );
    }
    return (
      <div className="templates-gallery">
        {showSearch && <SearchBar value={searchQuery} onChange={handleSearchChange} />}
        <EmptyStates section="templates" onAction={() => {}} />
      </div>
    );
  }

  return (
    <div className="templates-gallery">
      {showSearch && <SearchBar value={searchQuery} onChange={handleSearchChange} />}
      {Object.entries(grouped).map(([category, items]) => {
        const meta = CATEGORY_META[category] ?? CATEGORY_META.General;
        return (
          <section key={category} className="templates-gallery__section">
            <h3 className="templates-gallery__cat">
              {category}
              <span className="templates-gallery__count">{items.length}</span>
            </h3>
            <div className="templates-gallery__grid">
              {items.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card"
                  onClick={() => onSelect(template)}
                  title={template.description}
                >
                  <div
                    className="template-card__preview"
                    style={{ ['--tpl-accent' as string]: meta?.color }}
                  >
                    <span className="template-card__proxy">
                      <Icon name={meta?.icon ?? 'FileText'} label={undefined} size="1.25rem" />
                    </span>
                  </div>
                  <span className="template-card__name">{template.name}</span>
                  <span className="template-card__desc">{template.description}</span>
                  <div className="template-card__footer">
                    <span
                      className={`template-card__source template-card__source--${template.source}`}
                    >
                      {SOURCE_BADGE_LABELS[template.source]}
                    </span>
                    {template.usageCount > 0 && (
                      <span className="template-card__usage">
                        <Icon name="Users" label={undefined} size="0.75rem" />
                        {template.usageCount}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="templates-gallery__search">
      <Icon name="Search" label={undefined} size="1rem" />
      <input
        type="text"
        className="templates-gallery__search-input"
        placeholder="Search templates..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search templates"
      />
      {value && (
        <button
          type="button"
          className="templates-gallery__search-clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <Icon name="X" label={undefined} size="0.875rem" />
        </button>
      )}
    </div>
  );
}

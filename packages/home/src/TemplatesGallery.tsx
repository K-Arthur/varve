import type { TemplateDef } from '@strata/platform';
import { Icon, type IconName } from '@strata/ui';
import { EmptyStates } from './EmptyStates';

export interface TemplatesGalleryProps {
  onSelect: (template: TemplateDef) => void;
  templates?: TemplateDef[];
}

const BUILTIN_TEMPLATES: TemplateDef[] = [
  {
    id: 'blank',
    name: 'Blank Canvas',
    category: 'General',
    description: 'Start with an empty canvas.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
];

/** Per-category accent + icon so cards read at a glance without thumbnails. */
const CATEGORY_META: Record<string, { color: string; icon: IconName }> = {
  General: { color: 'var(--color-interactive-default)', icon: 'Frame' },
};

/** Preview aspect (width:height) per template so tiles hint at proportion. */
const PREVIEW_ASPECT: Record<string, string> = {
  blank: '4 / 3',
};

export function TemplatesGallery({ onSelect, templates }: TemplatesGalleryProps) {
  const allTemplates = templates ?? BUILTIN_TEMPLATES;

  if (allTemplates.length === 0) {
    return <EmptyStates section="templates" onAction={() => {}} />;
  }

  const grouped: Record<string, TemplateDef[]> = {};
  for (const t of allTemplates) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category]?.push(t);
  }

  return (
    <div className="templates-gallery">
      {Object.entries(grouped).map(([category, cats]) => {
        const meta = CATEGORY_META[category] ?? CATEGORY_META.General;
        return (
          <section key={category} className="templates-gallery__section">
            <h3 className="templates-gallery__cat">{category}</h3>
            <div className="templates-gallery__grid">
              {cats.map((template) => (
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
                    <span
                      className="template-card__proxy"
                      style={{ aspectRatio: PREVIEW_ASPECT[template.id] ?? '4 / 3' }}
                    >
                      <Icon name={meta?.icon ?? 'FileText'} label={undefined} size="1.25rem" />
                    </span>
                  </div>
                  <span className="template-card__name">{template.name}</span>
                  <span className="template-card__desc">{template.description}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

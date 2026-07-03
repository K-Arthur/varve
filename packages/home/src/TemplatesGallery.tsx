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
  {
    id: 'instagram-post',
    name: 'Instagram Post',
    category: 'Social',
    description: 'Square 1:1 format for social media.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'instagram-story',
    name: 'Instagram Story',
    category: 'Social',
    description: 'Vertical 9:16 format for stories.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'facebook-cover',
    name: 'Facebook Cover',
    category: 'Social',
    description: 'Banner format for social profiles.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'presentation-16-9',
    name: 'Presentation (16:9)',
    category: 'Presentation',
    description: 'Standard widescreen presentation format.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'a4',
    name: 'A4 Document',
    category: 'Print',
    description: 'Standard A4 print format with CMYK and bleed settings.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
  {
    id: 'us-letter',
    name: 'US Letter',
    category: 'Print',
    description: 'Standard US Letter print format.',
    documentJson: '{}',
    previewHash: '',
    builtin: true,
  },
];

/** Per-category accent + icon so cards read at a glance without thumbnails. */
const CATEGORY_META: Record<string, { color: string; icon: IconName }> = {
  General: { color: 'var(--color-interactive-default)', icon: 'Frame' },
  Social: { color: 'var(--color-feedback-warning)', icon: 'Image' },
  Presentation: { color: 'var(--color-feedback-success)', icon: 'Maximize' },
  Print: { color: 'var(--color-feedback-danger)', icon: 'FileText' },
};

/** Preview aspect (width:height) per template so tiles hint at proportion. */
const PREVIEW_ASPECT: Record<string, string> = {
  'instagram-post': '1 / 1',
  'instagram-story': '9 / 16',
  'facebook-cover': '16 / 6',
  'presentation-16-9': '16 / 9',
  a4: '210 / 297',
  'us-letter': '17 / 22',
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
